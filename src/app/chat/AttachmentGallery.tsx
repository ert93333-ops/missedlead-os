/**
 * 요청별 업로드 미디어 갤러리. GET /api/requests/:id/intake-media 결과를 썸네일로 표시.
 * 서명 URL 만료 시간을 함께 보여 주며 로딩/에러 상태를 처리한다.
 */
import { useCallback, useEffect, useState } from "react";
import { CameraIcon } from "../icons";

type MediaItem = { id: string; fileName: string; contentType: string; sizeBytes: number; url: string; expiresInSeconds: number };
type GalleryCaller = <T>(path: string, method?: string, body?: unknown, key?: string) => Promise<T>;

export function AttachmentGallery({ requestId, call, locale }: { requestId: string; call: GalleryCaller; locale?: "en" | "es" }) {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await call<{ media: MediaItem[] }>(`/api/requests/${requestId}/intake-media`);
      setMedia(result.media);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Attachments could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [call, requestId]);

  useEffect(() => {
    let active = true;
    void call<{ media: MediaItem[] }>(`/api/requests/${requestId}/intake-media`).then((result) => { if (active) setMedia(result.media); }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Attachments could not be loaded."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [call, requestId]);

  if (!loading && media.length === 0 && !error) return null;
  const es = locale === "es";
  return <section className="panel span-two attachment-gallery" data-testid="intake-media-gallery">
    <div className="section-title"><p><CameraIcon size={14}/>{es ? "ARCHIVOS DE LA SOLICITUD" : "REQUEST ATTACHMENTS"}</p><h2>{es ? "Fotos y grabaciones compartidas" : "Shared photos and recordings"}</h2></div>
    <p className="attachment-gallery__help">{es ? "Se eliminaron los metadatos del archivo. Actualice si el enlace caduca." : "File metadata has been removed. Refresh if a link expires."}</p>
    {loading && <p role="status">{es ? "Cargando archivos…" : "Loading attachments…"}</p>}
    {error && <div className="chat-error" role="alert"><p>{error}</p><button type="button" onClick={() => void load()}>{es ? "Intentar de nuevo" : "Try again"}</button></div>}
    {media.length > 0 && <div className="attachment-gallery__grid">{media.map((item) => <figure key={item.id}>
      {item.contentType.startsWith("image/") && <img src={item.url} alt={item.fileName} loading="lazy"/>}
      {item.contentType.startsWith("video/") && <video src={item.url} controls preload="metadata" aria-label={item.fileName}/>} 
      {item.contentType.startsWith("audio/") && <audio src={item.url} controls preload="metadata" aria-label={item.fileName}/>} 
      <figcaption><strong>{item.fileName}</strong><span>{(item.sizeBytes / 1024 / 1024).toFixed(1)} MB</span></figcaption>
    </figure>)}</div>}
    {media.length > 0 && <button type="button" onClick={() => void load()} disabled={loading}>{es ? "Actualizar enlaces" : "Refresh links"}</button>}
  </section>;
}
