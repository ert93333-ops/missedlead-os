import { useCallback, useEffect, useState } from "react";

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
  const es = locale === "es", en = locale === "en";
  return <section className="panel span-two attachment-gallery" data-testid="intake-media-gallery">
    <div className="section-title"><p>{es ? "ARCHIVOS DE LA SOLICITUD" : en ? "REQUEST ATTACHMENTS" : "현장 자료"}</p><h2>{es ? "Fotos y grabaciones compartidas" : en ? "Shared photos and recordings" : "고객이 공유한 사진과 녹화"}</h2></div>
    <p className="attachment-gallery__help">{es ? "Se eliminaron los metadatos del archivo. Actualice si el enlace caduca." : en ? "File metadata has been removed. Refresh if a link expires." : "파일 메타데이터를 제거했습니다. 링크가 만료되면 새로고침하세요."}</p>
    {loading && <p role="status">{es ? "Cargando archivos…" : en ? "Loading attachments…" : "자료를 불러오는 중입니다…"}</p>}
    {error && <div className="chat-error" role="alert"><p>{error}</p><button type="button" onClick={() => void load()}>{es ? "Intentar de nuevo" : en ? "Try again" : "다시 불러오기"}</button></div>}
    {media.length > 0 && <div className="attachment-gallery__grid">{media.map((item) => <figure key={item.id}>
      {item.contentType.startsWith("image/") && <img src={item.url} alt={item.fileName} loading="lazy"/>}
      {item.contentType.startsWith("video/") && <video src={item.url} controls preload="metadata" aria-label={item.fileName}/>} 
      {item.contentType.startsWith("audio/") && <audio src={item.url} controls preload="metadata" aria-label={item.fileName}/>} 
      <figcaption><strong>{item.fileName}</strong><span>{(item.sizeBytes / 1024 / 1024).toFixed(1)} MB</span></figcaption>
    </figure>)}</div>}
    {media.length > 0 && <button type="button" onClick={() => void load()} disabled={loading}>{es ? "Actualizar enlaces" : en ? "Refresh links" : "링크 새로고침"}</button>}
  </section>;
}
