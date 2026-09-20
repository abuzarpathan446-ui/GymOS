import { useState } from "react";
import { api } from "./api";
export function MemberPhoto({
  id,
  photo,
  onSaved,
  editable,
}: {
  id: string;
  photo?: string;
  onSaved: () => void;
  editable: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div>
      {photo && (
        <img
          src={photo}
          alt="Member profile"
          width="96"
          height="96"
          style={{ objectFit: "cover", borderRadius: 16 }}
        />
      )}
      {editable && (
        <label>
          Profile photo (PNG/JPEG, maximum 160 KB)
          <input
            type="file"
            accept="image/png,image/jpeg"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setError("");
              if (file.size > 160000) {
                setError("Choose an image smaller than 160 KB.");
                return;
              }
              setBusy(true);
              try {
                const data = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(String(reader.result));
                  reader.onerror = () =>
                    reject(new Error("Could not read image."));
                  reader.readAsDataURL(file);
                });
                await api(`/members/${id}/photo`, "PUT", { photo: data });
                onSaved();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      )}
      {busy && <p role="status">Saving photo…</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
