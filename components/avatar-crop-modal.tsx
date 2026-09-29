"use client";

import { useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";

async function cropPhoto(source: string, area: Area): Promise<File> {
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser couldn’t prepare this photo.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 512, 512);
  context.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    512,
    512,
  );
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (result) =>
        result
          ? resolve(result)
          : reject(
              new Error("Could not crop this photo. Please try another image."),
            ),
      "image/jpeg",
      0.9,
    ),
  );
  if (blob.size > 5 * 1024 * 1024)
    throw new Error("The cropped photo must be under 5 MB.");
  return new File([blob], "avatar.jpg", { type: "image/jpeg" });
}

export function AvatarCropModal({
  source,
  onCancel,
  onConfirm,
}: {
  source: string;
  onCancel: () => void;
  onConfirm: (file: File) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, []);
  async function confirm() {
    if (!area || busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm(await cropPhoto(source, area));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not save your photo. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="avatar-crop-dialog"
      aria-labelledby="crop-title"
      aria-describedby="crop-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <div className="p-5 sm:p-7">
        <h2 id="crop-title" className="text-xl font-semibold">
          Make it your photo
        </h2>
        <p id="crop-description" className="mt-2 text-sm text-slate-500">
          Drag to reposition, then zoom to find your best fit.
        </p>
        <div className="avatar-crop-stage mt-5" aria-busy={busy}>
          <Cropper
            image={source}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            minZoom={1}
            maxZoom={3}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, pixels) => setArea(pixels)}
            onCropAreaChange={(_, pixels) => setArea(pixels)}
            mediaProps={{
              onError: () => {
                setError(
                  "This image couldn’t be opened. Cancel and choose another JPG, PNG, or WebP.",
                );
                setArea(null);
              },
            }}
          />
          {busy && (
            <div
              className="absolute inset-0 z-10 grid place-items-center bg-slate-900/60 text-sm font-medium text-white"
              role="status"
            >
              Saving your photo…
            </div>
          )}
        </div>
        <div className="mt-5 flex items-center justify-between">
          <label htmlFor="crop-zoom">Zoom</label>
          <span className="text-xs text-slate-500">
            {Math.round(zoom * 100)}%
          </span>
        </div>
        <input
          id="crop-zoom"
          type="range"
          min="1"
          max="3"
          step="0.01"
          value={zoom}
          disabled={busy}
          onChange={(event) => setZoom(Number(event.target.value))}
          className="crop-zoom"
        />
        <p className="mt-2 text-xs text-slate-500">
          The circle shows how your avatar will appear. Use arrow keys on the
          image to reposition.
        </p>
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button-primary"
            disabled={busy || !area}
            onClick={confirm}
          >
            {busy ? "Saving…" : "Use photo"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
