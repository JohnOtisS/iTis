// Registers legacy file sizes without reading their contents or deleting data.
import { Pool } from "pg";
import { stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const { rows } = await pool.query(`
    SELECT a->>'url' AS url, c.user_id, 'chat' AS kind FROM messages m
    JOIN conversations c ON c.id=m.conversation_id, LATERAL jsonb_array_elements(m.attachments) a
    WHERE a->>'url' LIKE '/api/files/%'
    UNION SELECT '/api/images/' || id || '/file', user_id, 'image' FROM image_generations WHERE file_name IS NOT NULL
    UNION SELECT split_part(avatar_url,'?',1), id, 'avatar' FROM users WHERE avatar_url LIKE '/api/avatars/%'
  `);
  let registered = 0;
  for (const row of rows) {
    let path;
    if (row.kind === "chat") path = join(resolve(process.env.GENERATED_FILES_DIR || "storage/files"), basename(row.url));
    else if (row.kind === "avatar") path = join(resolve(process.env.AVATARS_DIR || "storage/avatars"), basename(row.url));
    else {
      const id = row.url.split("/")[3];
      const { rows: images } = await pool.query("SELECT file_name FROM image_generations WHERE id=$1", [id]);
      path = join(resolve(process.env.GENERATED_IMAGES_DIR || "/app/storage/generated"), basename(images[0].file_name));
    }
    const info = await stat(path).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    // Missing files consume no disk, but retain the user's history/reference.
    await pool.query(`INSERT INTO stored_files(url,user_id,bytes) VALUES($1,$2,$3)
      ON CONFLICT(url) DO UPDATE SET bytes=excluded.bytes`, [row.url, row.user_id, info?.size ?? 0]);
    registered++;
  }
  console.log(`Storage reconciled: ${registered} file references. No files deleted.`);
} finally { await pool.end(); }
