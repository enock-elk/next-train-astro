/**
 * Hand a picture to the phone's share sheet so the address bar never becomes a blob page.
 * A desktop browser that cannot share a file downloads it instead.
 * @param {File} file
 * @returns {Promise<'sheet'|'download'|'cancelled'>}
 */
export async function offerSavedImage(file) {
    const data = { files: [file], title: file.name };
    if (typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare(data)) {
        try {
            await navigator.share(data);
            return 'sheet';
        } catch (err) {
            if (err && err.name === 'AbortError') return 'cancelled';
            throw err;
        }
    }

    const url = URL.createObjectURL(file);
    try {
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        link.rel = 'noopener';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
    } finally {
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    return 'download';
}
