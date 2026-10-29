import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { ApiError, fail, ok } from "./envelope.js";
import { configFromRequest, generateJson } from "./llm.js";
import { extractText } from "./parser.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

const api = express.Router();
api.get("/health", (_req, res) => ok(res, { status: "up" }));

api.get("/llm-check", async (req, res, next) => {
  try {
    const cfg = configFromRequest(req);
    const out = await generateJson('Return exactly {"pong": true}', z.object({ pong: z.boolean() }), cfg);
    ok(res, { provider: cfg.provider, model: cfg.model, reply: out });
  } catch (e) {
    next(e);
  }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// L1 Schema
const parseSchema = z.object({
  course: z.object({
    title: z.string(),
    code: z.string(),
    department: z.string(),
    credits_ltp: z.string().regex(/^\d+:\d+:\d+$/, "Must be L:T:P format, e.g., 3:0:1"),
    course_type: z.string(),
    summary: z.string()
  }),
  course_outcomes: z.array(z.object({
    id: z.string().regex(/^CO-\d+$/),
    statement: z.string(),
    bloom_level: z.number().min(1).max(6)
  })).min(1),
  units: z.array(z.object({
    number: z.number(),
    title: z.string(),
    lab: z.string().nullable()
  })),
  co_po_pso_map: z.record(
    z.record(z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]), justification: z.string() }).nullable())
  ).optional(),
  teaching_hours: z.object({
    lectures: z.number(),
    lab: z.number(),
    tests_exams: z.number(),
    total: z.number()
  }),
  assessment: z.object({
    components: z.array(z.object({ name: z.string(), weight_percent: z.number() })),
    co_coverage: z.record(z.array(z.string()))
  })
});

export type ParsedCourseData = z.infer<typeof parseSchema>;

api.post("/parse", upload.fields([{ name: "spec", maxCount: 1 }, { name: "blueprint", maxCount: 1 }]), async (req, res, next) => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const specFile = files?.["spec"]?.[0];
    const blueprintFile = files?.["blueprint"]?.[0];
    
    if (!specFile) throw new ApiError(400, "BAD_INPUT", "Missing course specification file.");

    const specText = await extractText(specFile.mimetype, specFile.buffer, specFile.originalname);
    let blueprintText = "";
    if (blueprintFile) {
       blueprintText = await extractText(blueprintFile.mimetype, blueprintFile.buffer, blueprintFile.originalname);
    }

    const prompt = `
      Extract course specification details into JSON.
      
      BLUEPRINT (Highest priority for Course Outcomes and Unit Syllabus):
      ${blueprintText ? blueprintText.substring(0, 15000) : "No blueprint provided."}
      
      EXISTING SPEC (Use for metadata, summary, mapping, hours, and assessment):
      ${specText.substring(0, 15000)}
      
      RULES:
      1. Course outcomes MUST come from the blueprint if provided. If no blueprint, take from the spec.
      2. Credits must be formatted strictly as L:T:P (e.g., 3:0:1).
      3. Bloom's level is an integer 1-6 derived from the CO's leading verb.
      4. DO NOT invent data. Extract what is present.
    `;

    const cfg = configFromRequest(req);
    const data = await generateJson(prompt, parseSchema, cfg);
    ok(res, data);
  } catch (e) {
    next(e);
  }
});

api.post("/generate", upload.fields([{ name: "spec", maxCount: 1 }, { name: "blueprint", maxCount: 1 }]), (_req, res) => {
  fail(res, 501, "NOT_BUILT", "POST /api/v1/generate is not built yet (Level 3).");
});

app.use("/api/v1", api);
app.use("/api", (_req, res) => fail(res, 404, "NOT_FOUND", "No such route"));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) return fail(res, err.status, err.code, err.message);
  console.error("Unhandled:", err instanceof Error ? err.message : "unknown error");
  fail(res, 500, "SERVER_ERROR", "Something went wrong on the server.");
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`API on http://localhost:${port}/api/v1`));