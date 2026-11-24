import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await Promise.all([
  copyFile("classroom/index.html", "dist/index.html"),
  copyFile("classroom/classroom.mjs", "dist/classroom.mjs"),
  copyFile("classroom/classroom.css", "dist/classroom.css"),
  copyFile("site/styles.css", "dist/styles.css"),
  copyFile("site/js/quiz.mjs", "dist/quiz.mjs"),
]);
