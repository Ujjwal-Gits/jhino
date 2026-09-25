import { useCallback, useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { Icon, Modal } from './ui';

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB
export const ACCEPT_PHOTO_TYPES = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';

/** Validate file size and type (accepts JPG, PNG, WEBP up to 10 MB). */
export function validatePhotoFile(file: File): { ok: true } | { ok: false; error: string } {
  if (file.size > MAX_PHOTO_BYTES) {
    return { ok: false, error: 'Use a photo up to 10 MB.' };
  }
  const type = file.type.toLowerCase();
  const ext = file.name.toLowerCase().split('.').pop() || '';
  const validMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
  const validExts = ['jpg', 'jpeg', 'png', 'webp'];
  if (!validMimes.includes(type) && !validExts.includes(ext)) {
    return { ok: false, error: 'Use a JPG, PNG or WEBP photo.' };
  }
  return { ok: true };
}

/** Renders cropped, panned, zoomed & rotated pixels onto an offscreen canvas and exports a compressed blob. */
export async function renderAvatarBlob(
  img: HTMLImageElement,
  pan: { x: number; y: number },
  zoom: number,
  rotation: number,
  viewportSize = 280,
  outputSize = 640
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D rendering context');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const M = outputSize / viewportSize;
  const rad = (rotation * Math.PI) / 180;

  const isRotated90 = rotation % 180 !== 0;
  const effectiveW = isRotated90 ? img.naturalHeight : img.naturalWidth;
  const effectiveH = isRotated90 ? img.naturalWidth : img.naturalHeight;
  const baseScale = Math.max(viewportSize / effectiveW, viewportSize / effectiveH);

  ctx.save();
  ctx.translate(outputSize / 2 + pan.x * M, outputSize / 2 + pan.y * M);
  ctx.rotate(rad);
  ctx.scale(zoom, zoom);

  const drawW = img.naturalWidth * baseScale * M;
  const drawH = img.naturalHeight * baseScale * M;
  ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  // Compress to WebP (falls back to high quality JPEG if WebP not supported)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          canvas.toBlob(
            (fallbackBlob) => {
              if (fallbackBlob) resolve(fallbackBlob);
              else reject(new Error('Failed to compress avatar canvas'));
            },
            'image/jpeg',
            0.88
          );
        }
      },
      'image/webp',
      0.88
    );
  });
}

/* ---------------- View Modal: Click and view full avatar ---------------- */
export function AvatarViewerModal({
  name,
  username,
  src,
  isOpen,
  onClose,
  onReposition,
  onChange,
  onRemove,
  canEdit = true,
}: {
  name: string;
  username?: string;
  src: string;
  isOpen: boolean;
  onClose: () => void;
  onReposition?: () => void;
  onChange?: () => void;
  onRemove?: () => void;
  canEdit?: boolean;
}) {
  if (!isOpen) return null;

  return (
    <Modal title="Profile photo" onClose={onClose} wide={false}>
      <div className="av-view-wrap">
        <div className="av-view-frame">
          <img src={src} alt={`Profile photo of ${name}`} className="av-view-img" />
        </div>
        <div className="av-view-meta">
          <b>{name}</b>
          {username && <span className="muted">@{username}</span>}
        </div>
        <div className="av-view-actions">
          {canEdit && onReposition && (
            <button
              className="btn sm"
              type="button"
              onClick={() => {
                onClose();
                onReposition();
              }}
            >
              <Icon name="crop" size={15} />
              Reposition
            </button>
          )}
          {canEdit && onChange && (
            <button
              className="btn sm"
              type="button"
              onClick={() => {
                onClose();
                onChange();
              }}
            >
              <Icon name="image" size={15} />
              Change photo
            </button>
          )}
          <a href={src} target="_blank" rel="noopener noreferrer" className="btn sm quiet" title="Open full size in new tab">
            <Icon name="external" size={14} />
            Full size
          </a>
          {canEdit && onRemove && (
            <button
              className="btn sm quiet danger"
              type="button"
              onClick={() => {
                if (confirm('Remove your profile photo?')) {
                  onClose();
                  onRemove();
                }
              }}
            >
              <Icon name="trash" size={14} />
              Remove
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- Position & Crop Modal: Pan, zoom, rotate & compress ---------------- */
const VIEWPORT_SIZE = 280;

export function AvatarPositionModal({
  src,
  isOpen,
  onClose,
  onSave,
}: {
  src: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (compressedBlob: Blob) => Promise<void>;
}) {
  const [loaded, setLoaded] = useState(false);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1.0);
  const [rotation, setRotation] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);

  const imgRef = useRef<HTMLImageElement>(null);
  const dragStartRef = useRef({ pointerX: 0, pointerY: 0, startPanX: 0, startPanY: 0 });
  const touchDistRef = useRef<number | null>(null);

  // Reset state when a new image source is supplied
  useEffect(() => {
    if (src && isOpen) {
      setLoaded(false);
      setPan({ x: 0, y: 0 });
      setZoom(1.0);
      setRotation(0);
      setDragging(false);
      setSaving(false);
    }
  }, [src, isOpen]);

  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const el = e.currentTarget;
    setNatural({ width: el.naturalWidth, height: el.naturalHeight });
    setLoaded(true);
  };

  const isRotated90 = rotation % 180 !== 0;
  const effectiveW = isRotated90 ? natural.height : natural.width;
  const effectiveH = isRotated90 ? natural.width : natural.height;
  const baseScale = natural.width && natural.height ? Math.max(VIEWPORT_SIZE / effectiveW, VIEWPORT_SIZE / effectiveH) : 1;

  // Drag interaction with pointer capture
  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!loaded) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    };
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const dx = e.clientX - dragStartRef.current.pointerX;
    const dy = e.clientY - dragStartRef.current.pointerY;

    // Constrain pan so image cannot be completely lost outside viewport
    const maxRangeX = (effectiveW * baseScale * zoom) / 2 + VIEWPORT_SIZE * 0.25;
    const maxRangeY = (effectiveH * baseScale * zoom) / 2 + VIEWPORT_SIZE * 0.25;

    const newX = Math.min(maxRangeX, Math.max(-maxRangeX, dragStartRef.current.startPanX + dx));
    const newY = Math.min(maxRangeY, Math.max(-maxRangeY, dragStartRef.current.startPanY + dy));
    setPan({ x: newX, y: newY });
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) {
      setDragging(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  // Wheel zoom
  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.08 : -0.08;
    setZoom((z) => Math.min(3.5, Math.max(1.0, Number((z + delta).toFixed(2)))));
  };

  // Touch pinch zoom
  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (touchDistRef.current !== null) {
        const delta = (dist - touchDistRef.current) * 0.006;
        setZoom((z) => Math.min(3.5, Math.max(1.0, Number((z + delta).toFixed(2)))));
      }
      touchDistRef.current = dist;
    }
  };

  const handleTouchEnd = () => {
    touchDistRef.current = null;
  };

  // Rotate 90 degrees clockwise
  const handleRotate = () => {
    setRotation((r) => (r + 90) % 360);
    setPan({ x: 0, y: 0 }); // Center on rotation change
  };

  // Reset centering and zoom
  const handleReset = () => {
    setPan({ x: 0, y: 0 });
    setZoom(1.0);
    setRotation(0);
  };

  // Save and compress
  const handleSave = async () => {
    if (!imgRef.current || !loaded || saving) return;
    setSaving(true);
    try {
      const blob = await renderAvatarBlob(
        imgRef.current,
        pan,
        zoom,
        rotation,
        VIEWPORT_SIZE,
        640
      );
      await onSave(blob);
      onClose();
    } catch {
      /* handled in caller */
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !src) return null;

  return (
    <Modal title="Position photo" onClose={onClose} wide={false}>
      <div className="av-crop-wrap">
        <p className="hint av-crop-hint">
          Drag to reposition · Scroll or slide to zoom
        </p>

        {/* Viewport container */}
        <div
          className={`av-crop-viewport ${dragging ? 'is-dragging' : ''}`}
          style={{ width: VIEWPORT_SIZE, height: VIEWPORT_SIZE }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Loaded image */}
          <img
            ref={imgRef}
            src={src}
            alt="Positioning preview"
            crossOrigin="anonymous"
            onLoad={onImgLoad}
            className="av-crop-img"
            style={{
              width: `${natural.width * baseScale}px`,
              height: `${natural.height * baseScale}px`,
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) translate(-50%, -50%) rotate(${rotation}deg) scale(${zoom})`,
              display: loaded ? 'block' : 'none',
            }}
          />

          {!loaded && <div className="av-crop-loading"><span className="spin" /></div>}

          {/* Circular mask overlay showing exact avatar crop */}
          <div className="av-crop-mask" aria-hidden="true">
            {/* Rule of thirds grid lines */}
            <span className="av-crop-grid av-grid-h1" />
            <span className="av-crop-grid av-grid-h2" />
            <span className="av-crop-grid av-grid-v1" />
            <span className="av-crop-grid av-grid-v2" />
          </div>
        </div>

        {/* Zoom slider control */}
        <div className="av-zoom-row">
          <button
            type="button"
            className="icon-btn sm"
            title="Zoom out"
            disabled={zoom <= 1.0 || !loaded}
            onClick={() => setZoom((z) => Math.max(1.0, Number((z - 0.15).toFixed(2))))}
          >
            <Icon name="zoomOut" size={16} />
          </button>
          <input
            type="range"
            className="av-zoom-slider"
            min={1.0}
            max={3.5}
            step={0.02}
            value={zoom}
            disabled={!loaded}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Zoom photo"
          />
          <button
            type="button"
            className="icon-btn sm"
            title="Zoom in"
            disabled={zoom >= 3.5 || !loaded}
            onClick={() => setZoom((z) => Math.min(3.5, Number((z + 0.15).toFixed(2))))}
          >
            <Icon name="zoomIn" size={16} />
          </button>
          <span className="av-zoom-val mono">{zoom.toFixed(1)}×</span>
        </div>

        {/* Rotate and Reset quick tools */}
        <div className="av-crop-tools">
          <button
            type="button"
            className="btn sm quiet"
            disabled={!loaded}
            onClick={handleRotate}
            title="Rotate 90 degrees clockwise"
          >
            <Icon name="rotate" size={15} />
            Rotate 90°
          </button>
          <button
            type="button"
            className="btn sm quiet"
            disabled={!loaded || (zoom === 1.0 && pan.x === 0 && pan.y === 0 && rotation === 0)}
            onClick={handleReset}
            title="Reset position and zoom"
          >
            <Icon name="refresh" size={14} />
            Reset
          </button>
        </div>

        {/* Actions row */}
        <div className="actions-row av-crop-actions">
          <button
            className="btn sm primary"
            disabled={!loaded || saving}
            onClick={handleSave}
          >
            {saving ? <><span className="spin" />Saving photo…</> : 'Save photo'}
          </button>
          <button
            type="button"
            className="btn sm quiet"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
