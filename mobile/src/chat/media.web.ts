import { ChatError, validateAttachments, type Attachment } from './protocol';

const retainedFiles = new Map<string, File>();
const accepted = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/webm', 'audio/mp4', 'audio/wav', 'audio/x-wav'];
const mimeByExtension: Readonly<Record<string, string>> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav' };

export function retainedMedia(uri: string): File | undefined { return retainedFiles.get(uri); }
export function missingMedia(files: readonly Attachment[]): boolean { return files.some(file => !retainedFiles.has(file.uri)); }

function chooseFiles(source: 'camera' | 'video' | 'library' | 'audio'): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = source === 'library' || source === 'audio';
    input.accept = source === 'camera' ? 'image/jpeg,image/png,image/webp' : source === 'video' ? 'video/mp4,video/webm,video/quicktime' : source === 'audio' ? 'audio/mpeg,audio/mp4,audio/wav,audio/webm,.m4a,.mp3,.wav' : accepted.filter(type => !type.startsWith('audio/')).join(',');
    if (source === 'camera' || source === 'video') input.setAttribute('capture', 'environment');
    input.style.display = 'none'; document.body.append(input);
    const finish = (files: File[]) => { input.remove(); resolve(files); };
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])), { once: true });
    input.addEventListener('cancel', () => finish([]), { once: true });
    input.click();
  });
}

async function checkDuration(file: File): Promise<void> {
  if (!file.type.startsWith('video/') && !file.type.startsWith('audio/')) return;
  const media = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
  const uri = URL.createObjectURL(file);
  try {
    const duration = await new Promise<number | null>(resolve => {
      const timer = setTimeout(() => resolve(null), 5_000);
      media.onloadedmetadata = () => { clearTimeout(timer); resolve(media.duration); };
      media.onerror = () => { clearTimeout(timer); resolve(null); };
      media.preload = 'metadata'; media.src = uri;
    });
    if (duration !== null && Number.isFinite(duration) && duration > 60) throw new ChatError('media', 'video_duration');
  } finally { media.removeAttribute('src'); media.load(); URL.revokeObjectURL(uri); }
}

export async function pickMedia(source: 'camera' | 'video' | 'library' | 'audio', current: readonly Attachment[], _accountId?: string): Promise<Attachment[]> {
  const selected = await chooseFiles(source);
  if (!selected.length) return [...current];
  const normalized = selected.map(file => {
    const type = accepted.includes(file.type) ? file.type : mimeByExtension[file.name.toLowerCase().split('.').pop() ?? ''] ?? file.type;
    const name = file.name.normalize('NFKC').replace(/[^\p{L}\p{N}\p{M} _().-]/gu, '_').slice(-120) || 'repair';
    return new File([file], name, { type, lastModified: file.lastModified });
  });
  const next = [...current];
  const inserted: Attachment[] = [];
  try {
    for (const file of normalized) {
      const staleIndex = next.findIndex(item => !retainedFiles.has(item.uri) && item.name === file.name && item.size === file.size && item.mimeType === file.type);
      const metadata = { uri: '', name: file.name, size: file.size, mimeType: file.type };
      validateAttachments(staleIndex >= 0 ? next.map((item, index) => index === staleIndex ? metadata : item) : [...next, metadata]);
      await checkDuration(file);
      const uri = URL.createObjectURL(file);
      retainedFiles.set(uri, file);
      const attachment = { ...metadata, uri }; inserted.push(attachment);
      if (staleIndex >= 0) next[staleIndex] = attachment;
      else next.push(attachment);
    }
    return next;
  } catch (error) { discardMedia(inserted); throw error; }
}

export function discardMedia(files: readonly Attachment[], _accountId?: string): void {
  for (const file of files) {
    if (retainedFiles.delete(file.uri)) URL.revokeObjectURL(file.uri);
  }
}
