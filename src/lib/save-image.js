/**
 * Save a picture in the background. This does not open the share sheet,
 * and it does not leave a blob address in the address bar.
 * @param {File} file
 * @returns {Promise<void>}
 */
export async function downloadImageFile(file) {
    const name = file?.name || 'next-train.jpg';
    const mime = file?.type && String(file.type).startsWith('image/') ? file.type : 'image/jpeg';
    const click = (href, revoke) => {
        const link = document.createElement('a');
        link.href = href;
        link.setAttribute('download', name);
        link.rel = 'noopener';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
            link.remove();
            if (typeof revoke === 'function') revoke();
        }, 1500);
    };

    // A data address downloads on this phone. A blob address is what opened as a page.
    if (file && file.size > 0 && file.size < 2_500_000) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        const step = 0x8000;
        for (let i = 0; i < bytes.length; i += step) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + step, bytes.length)));
        }
        click(`data:${mime};base64,${btoa(binary)}`);
        return;
    }

    const url = URL.createObjectURL(file);
    click(url, () => URL.revokeObjectURL(url));
}
