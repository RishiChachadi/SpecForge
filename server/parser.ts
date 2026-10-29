import * as cheerio from "cheerio";
import mammoth from "mammoth";
import { ApiError } from "./envelope.js";
import { createRequire } from "node:module";

// Safely load older CJS libraries in an ESM environment
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
const WordExtractor = require("word-extractor");

export async function extractText(mimetype: string, buffer: Buffer, originalname: string): Promise<string> {
  try {
    const name = originalname.toLowerCase();
    
    if (name.endsWith(".docx") || mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    
    if (name.endsWith(".doc") || mimetype === "application/msword") {
      const extractor = new WordExtractor();
      const extracted = await extractor.extract(buffer);
      return extracted.getBody();
    }
    
    if (name.endsWith(".pdf") || mimetype === "application/pdf") {
      const data = await pdfParse(buffer);
      return data.text;
    }
    
    if (name.endsWith(".html") || mimetype === "text/html") {
      const $ = cheerio.load(buffer.toString("utf8"));
      return $("body").text();
    }
    
    throw new Error("Unsupported file format");
  } catch (e: any) {
    throw new ApiError(400, "BAD_FILE", `Cannot read file ${originalname}: ${e.message}`);
  }
}