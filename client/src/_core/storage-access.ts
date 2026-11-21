// Client-side helper for the browser-direct upload flow (DESIGN §5.6):
// ask the server for a signed PUT, upload straight to storage, then commit.
import { trpc } from "./trpc";

export async function uploadFile(file: File): Promise<{ key: string; publicPath: string }> {
  const { uploadUrl, key, publicPath } = await trpc.files.uploadUrl.mutateAsync({
    name: file.name,
    contentType: file.type || "application/octet-stream",
  });

  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);

  await trpc.files.commit.mutateAsync({ key, name: file.name });
  return { key, publicPath };
}
