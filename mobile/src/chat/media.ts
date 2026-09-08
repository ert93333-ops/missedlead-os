import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { createPermissionSelectionController } from '../platform/securityState';
import { type Attachment, ChatError, validateAttachments } from './protocol';

const extensions: Readonly<Record<string, string>> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };
const mimeForName = (name: string) => ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav' })[name.toLowerCase().split('.').pop() ?? ''];
const validAccountId = (value: string) => value.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(value);

type RetainedFile = { readonly exists: boolean; delete(): void };

function journalFile(accountId: string): File {
  const directory = new Directory(Paths.document, 'wecover-intake');
  directory.create({ intermediates: true, idempotent: true });
  return new File(directory, `${accountId}.json`);
}

function readJournal(accountId: string): string[] {
  const journal = journalFile(accountId);
  if (!journal.exists) return [];
  try {
    const value: unknown = JSON.parse(journal.textSync());
    return Array.isArray(value) && value.every(uri => typeof uri === 'string') ? value : [];
  } catch {
    return [];
  }
}

function writeJournal(accountId: string, uris: readonly string[]): void {
  const journal = journalFile(accountId);
  if (uris.length) journal.write(JSON.stringify([...new Set(uris)]));
  else if (journal.exists) journal.delete();
}

function addToJournal(accountId: string, uri: string): void {
  writeJournal(accountId, [...readJournal(accountId), uri]);
}

function removeFromJournal(accountId: string, removed: ReadonlySet<string>): void {
  writeJournal(accountId, readJournal(accountId).filter(uri => !removed.has(uri)));
}

export function retainMediaCopy(accountId: string, source: { copy(destination: File): void }, destination: File): void {
  if (!validAccountId(accountId)) throw new Error('The account identifier is invalid.');
  addToJournal(accountId, destination.uri);
  source.copy(destination);
}

export async function pickMedia(source: 'camera' | 'video' | 'library' | 'audio', current: readonly Attachment[], accountId?: string): Promise<Attachment[]> {
  if (accountId !== undefined && !validAccountId(accountId)) throw new Error('The account identifier is invalid.');
  let picked: { uri: string; name: string; mimeType: string }[] = [];
  if (source === 'audio') {
    const result = await DocumentPicker.getDocumentAsync({ type: ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm'], multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return [...current];
    picked = result.assets.map(asset => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? mimeForName(asset.name) ?? '' }));
  } else {
    const select = () => source === 'library'
      ? ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: Math.max(1, 10 - current.length), quality: 0.85 })
      : createPermissionSelectionController({
        getPermission: ImagePicker.getCameraPermissionsAsync,
        requestPermission: ImagePicker.requestCameraPermissionsAsync,
        select: () => ImagePicker.launchCameraAsync({ mediaTypes: source === 'video' ? ['videos'] : ['images'], videoMaxDuration: 60, quality: 0.85 }),
        permissionDenied: () => new ChatError('media', 'camera_permission'),
      }).select();
    const result = await select();
    if (result.canceled) return [...current];
    if (result.assets.some(asset => (asset.duration ?? 0) > 60_000)) throw new ChatError('media', 'video_duration');
    picked = result.assets.map(asset => ({ uri: asset.uri, name: asset.fileName ?? 'attachment', mimeType: asset.mimeType ?? mimeForName(asset.uri) ?? (asset.type === 'image' ? 'image/jpeg' : 'video/mp4') }));
  }
  const incoming = picked.map(asset => ({ ...asset, size: new File(asset.uri).size }));
  validateAttachments([...current, ...incoming]);
  const directory = new Directory(Paths.document, 'wecover-intake');
  directory.create({ intermediates: true, idempotent: true });
  const retained = incoming.map((asset, index) => {
    const name = `repair-${Date.now()}-${current.length + index}.${extensions[asset.mimeType] ?? 'bin'}`;
    const file = new File(directory, name);
    if (accountId) retainMediaCopy(accountId, new File(asset.uri), file);
    else new File(asset.uri).copy(file);
    return { ...asset, name, uri: file.uri };
  });
  return [...current, ...retained];
}

export function discardMedia(files: readonly Attachment[], accountId?: string, fileForUri: (uri: string) => RetainedFile = uri => new File(uri)): void {
  const deleted = new Set<string>();
  for (const item of files) {
    const file = fileForUri(item.uri);
    if (file.exists) file.delete();
    deleted.add(item.uri);
  }
  if (accountId && validAccountId(accountId)) removeFromJournal(accountId, deleted);
}

export function discardAccountMedia(accountId: string, fileForUri: (uri: string) => RetainedFile = uri => new File(uri)): void {
  if (!validAccountId(accountId)) return;
  const retained: string[] = [];
  let failure: unknown;
  for (const uri of readJournal(accountId)) {
    try {
      const file = fileForUri(uri);
      if (file.exists) file.delete();
    } catch (error) {
      retained.push(uri);
      failure ??= error;
    }
  }
  writeJournal(accountId, retained);
  if (failure) throw failure;
}

export function missingMedia(files: readonly Attachment[]): boolean {
  return files.some(item => !new File(item.uri).exists);
}
