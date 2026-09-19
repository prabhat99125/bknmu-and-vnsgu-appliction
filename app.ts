import fs from "fs/promises";
import path from "path";

const BASE_URL = "https://studentmobapi.vnsgu.net/api/student/getStudentDetail";
const BATCH_SIZE = 20;
const TOTAL_STUDENT_IDS = 10000000; // total ids to process; change as needed
const RESPONSE_DIR = path.join(process.cwd(), "responses");
const RESPONSE_FILE = path.join(RESPONSE_DIR, "students.ndjson");
const PROGRESS_FILE = path.join(RESPONSE_DIR, "progress.json");

interface StudentResponse {
  studentId?: number;
  responseText?: Array<Record<string, unknown>>;
  status?: string;
  error?: string;
  url?: string;
  result?: Array<Record<string, unknown>>;
}
let errorCount = 0;
async function fetchStudentResult(studentId: number): Promise<StudentResponse> {
  const url = `${BASE_URL}?StudentId=${studentId}`;

  try {
    const response = await fetch(url, {
      method: "POST",
    });
    const text = await response.json();

    if (text?.statusCode !== 200) {
      errorCount++;
      if (errorCount >= 30) {
        console.error("Too many errors encountered. Stopping further requests.");
        process.exit(1);
      }
    }
    return {
      studentId: text?.result?.[0]?.studentId ?? studentId,
      responseText: text.result,
    };
  } catch (error) {
    console.error(`Request failed for StudentId=${studentId}:`, error);
    return {
      studentId,
      url: `${BASE_URL}?StudentId=${studentId}`,
      status: "error",
      error: String(error),
    };
  }
}

async function getLastProcessedStudentId(): Promise<number> {
  try {
    const progressText = await fs.readFile(PROGRESS_FILE, "utf8");
    const progressData = JSON.parse(progressText) as { lastProcessedStudentId?: number };

    if (Number.isInteger(progressData.lastProcessedStudentId)) {
      return progressData.lastProcessedStudentId as number;
    }
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      console.warn("Could not read progress file; falling back to NDJSON history.", nodeError.message);
    }
  }

  try {
    const content = await fs.readFile(RESPONSE_FILE, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);

    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const item = JSON.parse(lines[i]) as StudentResponse;
        const studentId =
          item?.studentId ??
          item?.responseText?.[0]?.studentId ??
          item?.result?.[0]?.studentId;

        if (studentId !== undefined && studentId !== null) {
          return Number(studentId);
        }
      } catch {
        // Ignore malformed lines and continue scanning backwards.
      }
    }
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  return 0;
}

async function saveProgress(studentId: number): Promise<void> {
  await fs.mkdir(RESPONSE_DIR, { recursive: true });
  await fs.writeFile(
    PROGRESS_FILE,
    JSON.stringify({ lastProcessedStudentId: Number(studentId) }, null, 2),
    "utf8"
  );
}

async function saveStudentRecord(record: StudentResponse): Promise<void> {
  await fs.mkdir(RESPONSE_DIR, { recursive: true });

  const line = JSON.stringify(record);
  await fs.appendFile(RESPONSE_FILE, `${line}\n`, "utf8");

  const studentId = record?.studentId ?? record?.responseText?.[0]?.studentId ?? record?.result?.[0]?.studentId;

  if (studentId !== undefined && studentId !== null) {
    await saveProgress(Number(studentId));
  }
}

async function processBatch(startId: number): Promise<void> {
  const studentIds: number[] = [];

  for (let i = 0; i < BATCH_SIZE; i++) {
    const currentId = startId + i;
    if (currentId > TOTAL_STUDENT_IDS) break;
    studentIds.push(currentId);
  }

  if (studentIds.length === 0) {
    console.log("No more StudentIds left to process.");
    return;
  }

  console.log(`Starting batch: ${studentIds[0]} to ${studentIds[studentIds.length - 1]}`);

  for (const studentId of studentIds) {
    const result = await fetchStudentResult(studentId);
    await saveStudentRecord(result);
  }

  console.log(`Batch complete: ${studentIds.length} responses processed.`);
}

async function main(): Promise<void> {
  const lastProcessedStudentId = await getLastProcessedStudentId();
  let startId = lastProcessedStudentId + 1;

  if (lastProcessedStudentId > 0) {
    console.log(`Resuming from StudentId=${startId}`);
  }

  while (startId <= TOTAL_STUDENT_IDS) {
    await processBatch(startId);
    startId += BATCH_SIZE;
  }
}

main().catch((error) => {
  console.error("Main process error:", error);
});
