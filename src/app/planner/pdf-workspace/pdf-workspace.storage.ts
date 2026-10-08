import { PdfWorkspace } from './pdf-workspace.model';
import type { PdfHallBinding } from './pdf-hall-plan';

const DATABASE = 'planner-pdf-workspaces';
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('documents'))
        request.result.createObjectStore('documents', { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains('hallReferences'))
        request.result.createObjectStore('hallReferences', { keyPath: 'hallId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error('Local storage is unavailable. Keep this tab open and export a backup.'));
    request.onblocked = () =>
      reject(new Error('Close other PDF workspace tabs and try saving again.'));
  });
}
export async function saveWorkspace(doc: PdfWorkspace): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite');
      tx.objectStore('documents').put(doc);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(new Error('Could not save this PDF locally. Export a backup before closing.'));
    });
  } finally {
    db.close();
  }
}
export async function loadWorkspace(id: string): Promise<PdfWorkspace | undefined> {
  const db = await open();
  try {
    return await new Promise<PdfWorkspace | undefined>((resolve, reject) => {
      const request = db.transaction('documents').objectStore('documents').get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Could not reopen this locally saved PDF.'));
    });
  } finally {
    db.close();
  }
}
export async function listWorkspaces(): Promise<
  Array<Pick<PdfWorkspace, 'id' | 'name' | 'updatedAt'>>
> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const items: Array<Pick<PdfWorkspace, 'id' | 'name' | 'updatedAt'>> = [];
      const request = db.transaction('documents').objectStore('documents').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(items.sort((a, b) => b.updatedAt - a.updatedAt));
          return;
        }
        const { id, name, updatedAt } = cursor.value as PdfWorkspace;
        items.push({ id, name, updatedAt });
        cursor.continue();
      };
      request.onerror = () => reject(new Error('Could not read locally saved documents.'));
    });
  } finally {
    db.close();
  }
}
export async function hashPdf(pdf: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', pdf))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function saveHallBinding(binding: PdfHallBinding): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('hallReferences', 'readwrite');
      tx.objectStore('hallReferences').put(binding);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () =>
        reject(
          new Error(
            'Hall saved, but its local PDF reference could not be linked. Retry to attach it.',
          ),
        );
    });
  } finally {
    db.close();
  }
}

export async function listHallBindings(): Promise<PdfHallBinding[]> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('hallReferences').objectStore('hallReferences').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Could not read the local PDF reference links.'));
    });
  } finally {
    db.close();
  }
}
