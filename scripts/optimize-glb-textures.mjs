import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, chromeExecutablePath } from "./qa-runtime.mjs";

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const outputRoot = path.resolve(".tmp/optimized-models");
const maxTextureSize = Number(process.env.GLB_MAX_TEXTURE_SIZE ?? 1024);
const webpQuality = Number(process.env.GLB_WEBP_QUALITY ?? 0.9);
const sourceFiles = process.argv
  .slice(2)
  .filter((argument) => !argument.startsWith("--"));

if (sourceFiles.length === 0) {
  throw new Error(
    "Usage: node scripts/optimize-glb-textures.mjs <model.glb> [more.glb ...]",
  );
}

function parseGlb(buffer, filename) {
  if (buffer.readUInt32LE(0) !== GLB_MAGIC || buffer.readUInt32LE(4) !== 2) {
    throw new Error(`${filename} is not a glTF 2.0 binary.`);
  }

  let offset = 12;
  let json = null;
  let binary = null;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === JSON_CHUNK) json = JSON.parse(data.toString("utf8").trim());
    if (type === BIN_CHUNK) binary = data;
    offset += 8 + length;
  }

  if (!json || !binary) throw new Error(`${filename} is missing JSON or BIN data.`);
  if ((json.buffers?.length ?? 0) !== 1) {
    throw new Error(`${filename} uses multiple buffers; this script expects one embedded buffer.`);
  }
  return { json, binary };
}

function align4(value) {
  return (value + 3) & ~3;
}

function textureUsage(json) {
  const usage = new Map();
  const assign = (textureIndex, role) => {
    if (!Number.isInteger(textureIndex)) return;
    const source = json.textures?.[textureIndex]?.source;
    if (!Number.isInteger(source)) return;
    const roles = usage.get(source) ?? new Set();
    roles.add(role);
    usage.set(source, roles);
  };

  for (const material of json.materials ?? []) {
    assign(material.pbrMetallicRoughness?.baseColorTexture?.index, "baseColor");
    assign(material.pbrMetallicRoughness?.metallicRoughnessTexture?.index, "metalRoughness");
    assign(material.normalTexture?.index, "normal");
    assign(material.occlusionTexture?.index, "occlusion");
    assign(material.emissiveTexture?.index, "emissive");
  }
  return usage;
}

async function transcodeImage(page, bytes, mimeType, quality) {
  const dataUrl = `data:${mimeType};base64,${bytes.toString("base64")}`;
  return page.evaluate(
    async ({ source, maxSize, webpQuality: outputQuality }) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("Canvas 2D context is unavailable.");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, width, height);
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/webp", outputQuality),
      );
      if (!blob) throw new Error("WebP encoding failed.");
      const encoded = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let index = 0; index < encoded.length; index += 0x8000) {
        binary += String.fromCharCode(...encoded.subarray(index, index + 0x8000));
      }
      return {
        base64: btoa(binary),
        width,
        height,
        sourceWidth: image.naturalWidth,
        sourceHeight: image.naturalHeight,
        type: blob.type,
      };
    },
    { source: dataUrl, maxSize: maxTextureSize, webpQuality: quality },
  );
}

function rebuildGlb(json, binary, replacements) {
  const chunks = [];
  let byteLength = 0;
  const nextViews = [];

  for (const [index, view] of (json.bufferViews ?? []).entries()) {
    const start = view.byteOffset ?? 0;
    const original = binary.subarray(start, start + view.byteLength);
    const replacement = replacements.get(index);
    const content = replacement ?? original;
    const alignedOffset = align4(byteLength);
    if (alignedOffset > byteLength) {
      chunks.push(Buffer.alloc(alignedOffset - byteLength));
      byteLength = alignedOffset;
    }
    chunks.push(content);
    nextViews.push({
      ...view,
      byteOffset: byteLength,
      byteLength: content.length,
    });
    byteLength += content.length;
  }

  const binaryLength = align4(byteLength);
  chunks.push(Buffer.alloc(binaryLength - byteLength));
  const nextBinary = Buffer.concat(chunks);
  const nextJson = {
    ...json,
    bufferViews: nextViews,
    buffers: json.buffers.map((buffer, index) =>
      index === 0 ? { ...buffer, byteLength } : buffer,
    ),
  };

  const jsonBytes = Buffer.from(JSON.stringify(nextJson), "utf8");
  const jsonLength = align4(jsonBytes.length);
  const jsonPadding = Buffer.alloc(jsonLength - jsonBytes.length, 0x20);
  const totalLength = 12 + 8 + jsonLength + 8 + binaryLength;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonLength, 0);
  jsonHeader.writeUInt32LE(JSON_CHUNK, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binaryLength, 0);
  binaryHeader.writeUInt32LE(BIN_CHUNK, 4);

  return Buffer.concat([
    header,
    jsonHeader,
    jsonBytes,
    jsonPadding,
    binaryHeader,
    nextBinary,
  ]);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: chromeExecutablePath(),
});
const page = await browser.newPage();
await mkdir(outputRoot, { recursive: true });

for (const sourceFile of sourceFiles) {
  const sourcePath = path.resolve(sourceFile);
  const original = await readFile(sourcePath);
  const { json, binary } = parseGlb(original, sourceFile);
  const usage = textureUsage(json);
  const replacements = new Map();
  const imageStats = [];

  for (const [imageIndex, image] of (json.images ?? []).entries()) {
    if (!Number.isInteger(image.bufferView)) continue;
    const view = json.bufferViews[image.bufferView];
    const start = view.byteOffset ?? 0;
    const bytes = binary.subarray(start, start + view.byteLength);
    const encoded = await transcodeImage(
      page,
      bytes,
      image.mimeType ?? "image/png",
      webpQuality,
    );
    const optimized = Buffer.from(encoded.base64, "base64");
    const useOptimized = optimized.length < bytes.length;
    if (useOptimized) {
      replacements.set(image.bufferView, optimized);
      image.mimeType = "image/webp";
    }
    imageStats.push({
      imageIndex,
      roles: [...(usage.get(imageIndex) ?? [])],
      source: `${encoded.sourceWidth}x${encoded.sourceHeight}`,
      output: `${encoded.width}x${encoded.height}`,
      before: bytes.length,
      after: useOptimized ? optimized.length : bytes.length,
      format: useOptimized ? "webp" : image.mimeType,
    });
  }

  const optimized = rebuildGlb(json, binary, replacements);
  const outputPath = path.join(outputRoot, path.basename(sourceFile));
  await writeFile(outputPath, optimized);
  console.log(
    JSON.stringify(
      {
        sourceFile: path.basename(sourceFile),
        outputPath,
        before: original.length,
        after: optimized.length,
        savedPercent: Number(((1 - optimized.length / original.length) * 100).toFixed(1)),
        maxTextureSize,
        webpQuality,
        images: imageStats,
      },
      null,
      2,
    ),
  );
}

await browser.close();
