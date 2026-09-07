/*
 * PRS.AssetVerify 2.0 - Patch 9 iOS Camera / Scan Evidence Hotfix
 * Applies AFTER the existing Patch 8 app.js.
 * Goals:
 *  - Make iPhone native camera picker invocation more reliable.
 *  - Keep the live camera open even if the barcode decoder fails to initialise.
 *  - Pre-warm the iOS barcode decoder before Start Camera is tapped.
 *  - Capture the exact live scan frame with low-memory iOS fallbacks.
 *  - Never allow a scan verification to continue/save without evidence photo(s).
 */
(function () {
  'use strict';

  const PATCH_BUILD = '2.0.9-ios-camera-hotfix';
  const byId = id => document.getElementById(id);
  console.info(`[PRS.AssetVerify] ${PATCH_BUILD} loaded`);

  // -------------------------------------------------------------------------
  // Low-memory canvas encoding fallback for Mobile Safari
  // -------------------------------------------------------------------------
  function dataUrlToBlob(dataUrl) {
    try {
      const parts = String(dataUrl || '').split(',');
      if (parts.length !== 2) return null;
      const mime = (parts[0].match(/^data:([^;]+);base64$/i) || [])[1] || 'image/jpeg';
      const binary = atob(parts[1]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    } catch (error) {
      console.warn('Data URL to Blob fallback failed:', error);
      return null;
    }
  }

  async function canvasToJpegBlob(canvas, quality) {
    let blob = null;
    if (canvas && typeof canvas.toBlob === 'function') {
      try {
        blob = await Promise.race([
          new Promise(resolve => {
            try { canvas.toBlob(resolve, 'image/jpeg', quality); }
            catch (_) { resolve(null); }
          }),
          new Promise(resolve => setTimeout(() => resolve(null), 1800))
        ]);
      } catch (_) {}
    }
    if (blob) return blob;

    // Some iOS/WebKit builds can return null / stall in toBlob after camera work.
    // The canvas is already downscaled before this fallback, so toDataURL is safe.
    try {
      return dataUrlToBlob(canvas.toDataURL('image/jpeg', quality));
    } catch (error) {
      console.warn('Canvas JPEG fallback failed:', error);
      return null;
    }
  }

  // Replace Patch 8 compression with a lower-memory Safari-safe variant.
  // decodePhotoSource(), blobToDataUrl() are supplied by app.js.
  compressPhoto = async function prsCompressPhoto(file) {
    const decoded = await decodePhotoSource(file);
    try {
      let w = Number(decoded.width || 0), h = Number(decoded.height || 0);
      if (!w || !h) throw new Error('Image dimensions are unavailable.');

      const maxDimension = 1280;
      const targetBytes = 500 * 1024;
      const minDimension = 640;
      if (Math.max(w, h) > maxDimension) {
        const scale = maxDimension / Math.max(w, h);
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
      }

      let quality = 0.78;
      let blob = null;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Image compression is unavailable on this browser.');

      for (let pass = 0; pass < 9; pass++) {
        canvas.width = w;
        canvas.height = h;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(decoded.image, 0, 0, w, h);

        blob = await canvasToJpegBlob(canvas, quality);
        if (!blob) throw new Error('Image compression failed.');
        if (blob.size <= targetBytes || Math.max(w, h) <= minDimension) break;

        if (quality > 0.54) quality -= 0.07;
        else {
          w = Math.max(1, Math.round(w * 0.86));
          h = Math.max(1, Math.round(h * 0.86));
          quality = 0.68;
        }
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      const result = {
        dataUrl: await blobToDataUrl(blob),
        size: blob.size,
        width: w,
        height: h,
        compressed: true
      };
      canvas.width = 1;
      canvas.height = 1;
      return result;
    } finally {
      try { decoded.cleanup?.(); } catch (_) {}
    }
  };

  // -------------------------------------------------------------------------
  // Native camera / gallery picker: iPhone-safe direct user-gesture path
  // -------------------------------------------------------------------------
  let pickerSeq = 0;
  let scannerStartSeq = 0;

  const patch8ReleaseScanner = releaseScannerForNativeCapture;
  releaseScannerForNativeCapture = function prsReleaseScannerForNativeCapture() {
    scannerStartSeq++;
    return patch8ReleaseScanner();
  };

  function makePickerRenderable(input) {
    if (!input) return;
    // A rendered but off-screen file input is more reliable than display:none on
    // iOS when showPicker()/click() is invoked from a custom button.
    input.hidden = false;
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    Object.assign(input.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      width: '1px',
      height: '1px',
      opacity: '0.001',
      pointerEvents: 'none',
      zIndex: '-1'
    });
  }

  function resetNativeCaptureBusy() {
    try { nativeCaptureBusy = false; } catch (_) {}
  }

  openNativeCapture = function prsOpenNativeCapture(input, { append = false } = {}) {
    if (!input) {
      toast('Camera input is unavailable. Reload the page and try again.', 4200);
      return;
    }

    const seq = ++pickerSeq;
    // Do not let an earlier cancelled iPhone picker leave the app permanently busy.
    resetNativeCaptureBusy();
    nativeCaptureBusy = true;
    appendPhotoMode = append;

    // This is synchronous and deliberately happens inside the user's tap.
    releaseScannerForNativeCapture();
    try { input.value = ''; } catch (_) {}
    makePickerRenderable(input);

    let opened = false;
    let lastError = null;

    // showPicker() is the preferred standards-based route for file inputs.
    try {
      if (typeof input.showPicker === 'function') {
        input.showPicker();
        opened = true;
      }
    } catch (error) {
      lastError = error;
      console.debug('showPicker() unavailable/blocked, falling back to click():', error);
    }

    if (!opened) {
      try {
        input.click();
        opened = true;
      } catch (error) {
        lastError = error;
        console.error('Native file/camera picker failed:', error);
      }
    }

    setTimeout(() => {
      if (seq === pickerSeq) resetNativeCaptureBusy();
    }, 1400);

    if (!opened) {
      toast(`Camera could not be opened${lastError?.message ? `: ${lastError.message}` : '.'}`, 5000);
    }
  };

  const cameraInput = byId('cameraInput');
  const galleryInput = byId('galleryInput');
  if (cameraInput) {
    makePickerRenderable(cameraInput);
    cameraInput.addEventListener('cancel', resetNativeCaptureBusy);
  }
  if (galleryInput) {
    makePickerRenderable(galleryInput);
    galleryInput.addEventListener('cancel', resetNativeCaptureBusy);
  }
  window.addEventListener('pageshow', resetNativeCaptureBusy);
  window.addEventListener('focus', () => setTimeout(resetNativeCaptureBusy, 120));

  if (byId('takePhotoBtn')) {
    byId('takePhotoBtn').onclick = () => {
      if (!hasPermission('verification.capture_photo')) return;
      openNativeCapture(cameraInput, { append: false });
    };
  }
  if (byId('uploadPhotoBtn')) {
    byId('uploadPhotoBtn').onclick = () => {
      if (!hasPermission('verification.upload_gallery')) return;
      openNativeCapture(galleryInput, { append: false });
    };
  }
  if (byId('addCameraPhotoBtn')) {
    byId('addCameraPhotoBtn').onclick = () => openNativeCapture(cameraInput, { append: true });
  }
  if (byId('addGalleryPhotosBtn')) {
    byId('addGalleryPhotosBtn').onclick = () => openNativeCapture(galleryInput, { append: true });
  }

  // -------------------------------------------------------------------------
  // Scanner decoder pre-warm + camera acquisition
  // -------------------------------------------------------------------------
  let decoderWarmPromise = null;
  function prewarmScannerDecoder() {
    if (nativeScannerClass() || scannerPolyfillClass()) return Promise.resolve(true);
    if (decoderWarmPromise) return decoderWarmPromise;
    decoderWarmPromise = ensureScannerFallbackEngine()
      .then(() => true)
      .catch(error => {
        console.warn('Scanner pre-warm failed:', error);
        return false;
      })
      .finally(() => { decoderWarmPromise = null; });
    return decoderWarmPromise;
  }

  const patch8OpenScanner = openScanner;
  openScanner = function prsOpenScanner() {
    patch8OpenScanner();
    // Start the decoder download while the user is looking at the scanner modal,
    // before Start Camera is tapped. Do not block the UI.
    if (navigator.onLine) prewarmScannerDecoder();
  };
  if (byId('scanVerifyBtn')) byId('scanVerifyBtn').onclick = () => openScanner();

  const patch8StopScanner = stopScanner;
  stopScanner = async function prsStopScanner(options = {}) {
    scannerStartSeq++;
    return patch8StopScanner(options);
  };

  async function requestRearCamera() {
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    try {
      // Keep constraints intentionally simple on iPhone. Extra width/height/fps
      // constraints can make camera selection less reliable on some WebKit builds.
      return await gum({ audio: false, video: { facingMode: { ideal: 'environment' } } });
    } catch (error) {
      const name = String(error?.name || '');
      if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
        return gum({ audio: false, video: true });
      }
      throw error;
    }
  }

  startScanner = async function prsStartScanner() {
    if (scannerRunning) {
      await stopScanner();
      return;
    }
    if (!window.isSecureContext) {
      byId('scanStatus').textContent = 'Camera requires HTTPS. Open the PRS2 GitHub Pages website.';
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      byId('scanStatus').textContent = 'Live camera is unavailable. Open this site directly in current Safari on iPhone.';
      return;
    }

    const seq = ++scannerStartSeq;
    const button = byId('startScannerBtn');
    button.disabled = true;
    button.textContent = 'Opening Camera…';
    byId('scanStatus').textContent = 'Opening rear camera… allow Camera permission if Safari asks.';
    scannerAutoProceed = false;
    scannerScanBusy = false;
    scannerFrameCount = 0;

    let stream = null;
    try {
      // Start decoder initialisation and getUserMedia in parallel. Crucially, do
      // not await the decoder before requesting the camera; this preserves the
      // user's tap for iPhone Safari.
      const detectorPromise = createScannerDetector();
      stopTracksSynchronously();
      clearTimeout(scannerLoopTimer);
      scannerLoopTimer = null;

      stream = await requestRearCamera();
      if (seq !== scannerStartSeq) {
        stream.getTracks?.().forEach(track => { try { track.stop(); } catch (_) {} });
        return;
      }
      scannerStream = stream;

      const video = buildScannerVideo();
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');

      // Start playback immediately; then wait for dimensions.
      try {
        const play = video.play();
        if (play?.catch) play.catch(() => {});
      } catch (_) {}
      await waitForVideoReady(video, 8000);
      if (seq !== scannerStartSeq) return;

      scannerRunning = true;
      scannerStartedAt = Date.now();
      button.disabled = false;
      button.textContent = 'Stop Camera';
      byId('scanStatus').textContent = 'Camera is live. Preparing QR / barcode recognition…';
      tuneMobileCamera(video).catch(() => {});

      let detector = null;
      try { detector = await detectorPromise; }
      catch (error) {
        console.error('Barcode decoder could not initialise while camera remained live:', error);
      }
      if (seq !== scannerStartSeq || !scannerRunning || scannerStream !== stream) return;

      if (!detector) {
        scannerDetector = null;
        byId('scanStatus').textContent =
          'Camera is live, but automatic QR / barcode recognition could not load. Enter the code manually and tap Use Code(s) & Verify — the evidence photo will still be captured from this live camera.';
        return;
      }

      scannerDetector = detector;
      button.disabled = false;
      button.textContent = 'Stop Camera';
      byId('scanStatus').textContent =
        `Camera is live and scanning automatically${scannerEngineSource ? ` (${scannerEngineSource})` : ''}. Hold the complete QR / barcode steady inside the box.`;
      scheduleScannerLoop(180);
    } catch (error) {
      console.error('iPhone/mobile scanner start failed:', error);
      scannerRunning = false;
      scannerScanBusy = false;
      scannerDetector = null;
      clearTimeout(scannerLoopTimer);
      scannerLoopTimer = null;
      if (stream?.getTracks) {
        for (const track of stream.getTracks()) { try { track.stop(); } catch (_) {} }
      }
      stopTracksSynchronously();
      byId('qrReader').innerHTML = '';
      button.disabled = false;
      button.textContent = 'Start Camera';
      byId('scanStatus').textContent = `Camera scanner could not start. ${cameraErrorMessage(error)}`;
    }
  };
  if (byId('startScannerBtn')) byId('startScannerBtn').onclick = startScanner;

  // -------------------------------------------------------------------------
  // Robust evidence frame capture
  // -------------------------------------------------------------------------
  async function waitForFreshVideoFrame(video) {
    if (!video) return;
    if (typeof video.requestVideoFrameCallback === 'function') {
      await Promise.race([
        new Promise(resolve => video.requestVideoFrameCallback(() => resolve())),
        new Promise(resolve => setTimeout(resolve, 180))
      ]);
    } else {
      await new Promise(resolve => setTimeout(resolve, 70));
    }
  }

  captureScannerEvidenceFile = async function prsCaptureScannerEvidenceFile() {
    const video = byId('prsMobileScanVideo');
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;

    try {
      await waitForFreshVideoFrame(video);
      const srcW = Number(video.videoWidth || 0);
      const srcH = Number(video.videoHeight || 0);
      if (!srcW || !srcH) return null;

      // 1024px keeps iPhone memory pressure low while remaining clear in Excel.
      const maxSide = 1024;
      const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
      const w = Math.max(1, Math.round(srcW * scale));
      const h = Math.max(1, Math.round(srcH * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return null;

      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(video, 0, 0, w, h);
      const blob = await canvasToJpegBlob(canvas, 0.76);
      canvas.width = 1;
      canvas.height = 1;
      if (!blob || !blob.size) return null;

      const name = `scan-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
      try {
        return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
      } catch (_) {
        try { blob.name = name; } catch (_) {}
        return blob;
      }
    } catch (error) {
      console.warn('Could not capture scanner evidence frame:', error);
      return null;
    }
  };

  async function captureScannerEvidenceWithRetry() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const evidence = await captureScannerEvidenceFile();
      if (evidence) return evidence;
      await new Promise(resolve => setTimeout(resolve, 100 + attempt * 80));
    }
    return null;
  }

  handleScannerDecoded = function prsHandleScannerDecoded(decoded) {
    const value = String(decoded || '').trim();
    if (!value || scannerAutoProceed) return;

    scannerAutoProceed = true;
    scanCodes = [value];
    byId('manualScanCode').value = value;
    renderScanCodes();
    try { navigator.vibrate?.(100); } catch (_) {}
    byId('scanStatus').textContent = `Code detected: ${value}. Capturing evidence photo…`;

    (async () => {
      try {
        const evidence = await captureScannerEvidenceWithRetry();
        if (!evidence) {
          // Do NOT continue without a photo. Keep the live camera available so
          // the user can tap Use Code(s) & Verify, which retries frame capture.
          byId('scanStatus').textContent =
            `Code detected: ${value}, but the evidence photo was not captured. Keep the camera open and tap Use Code(s) & Verify to retry the photo capture.`;
          return;
        }

        scanEvidenceFiles = [evidence, ...scanEvidenceFiles].slice(0, 12);
        byId('scanStatus').textContent = `Code detected: ${value}. Photo captured. Opening verification…`;
        await stopScanner({ preserveStatus: true });
        byId('scannerModal').classList.add('hidden');
        await prepareScanRecord([value], scanEvidenceFiles);
      } catch (error) {
        console.error('Automatic scan continuation failed:', error);
        scannerAutoProceed = false;
        byId('scanStatus').textContent =
          'The code was read but the verification could not open. Tap Use Code(s) & Verify to retry.';
      }
    })();
  };

  // -------------------------------------------------------------------------
  // Scan verification MUST contain evidence photo
  // -------------------------------------------------------------------------
  const patch8PrepareScanRecord = prepareScanRecord;
  prepareScanRecord = async function prsPrepareScanRecord(codes, evidenceFiles = []) {
    const evidence = [...(evidenceFiles || [])].filter(Boolean);
    if (!evidence.length) {
      scannerAutoProceed = false;
      toast('Evidence photo is required for every scanned tag.', 4500);
      const status = byId('scanStatus');
      if (status) status.textContent =
        'The code is ready, but no evidence photo exists. Start the camera and tap Use Code(s) & Verify, or use Scan Image.';
      return false;
    }
    await patch8PrepareScanRecord(codes, evidence);
    if (pendingRecord?.source === 'scan' && !(pendingRecord.photos || []).length) {
      pendingRecord = null;
      scannerAutoProceed = false;
      toast('The scan photo could not be prepared. Please scan again.', 4500);
      return false;
    }
    return true;
  };

  if (byId('useScanCodeBtn')) {
    byId('useScanCodeBtn').onclick = async () => {
      const manual = byId('manualScanCode').value.trim();
      const codes = [...new Set([...scanCodes, ...(manual ? [manual] : [])])];
      if (!codes.length) {
        toast('Scan or enter at least one code first.');
        return;
      }

      let evidenceFiles = [...scanEvidenceFiles];
      if (!evidenceFiles.length && scannerRunning) {
        byId('scanStatus').textContent = 'Capturing evidence photo from the live camera…';
        const evidence = await captureScannerEvidenceWithRetry();
        if (evidence) {
          evidenceFiles = [evidence];
          scanEvidenceFiles = [evidence];
        }
      }

      if (!evidenceFiles.length) {
        scannerAutoProceed = false;
        toast('A photo is compulsory for Scan & Verify.', 4500);
        byId('scanStatus').textContent =
          'No evidence photo was captured. Tap Start Camera, then tap Use Code(s) & Verify again; or use Scan Image.';
        return;
      }

      await closeScanner();
      await prepareScanRecord(codes, evidenceFiles);
    };
  }

  // Final client-side guard: even a stale/corner-case scan cannot be saved empty.
  const saveButton = byId('savePhotoBtn');
  if (saveButton && typeof saveButton.onclick === 'function') {
    const patch8SaveHandler = saveButton.onclick;
    saveButton.onclick = async function prsSaveVerificationGuard(event) {
      if (pendingRecord?.source === 'scan' && !(pendingRecord.photos || []).length) {
        toast('Cannot save a scanned tag without its evidence photo. Scan again.', 5000);
        return;
      }
      return patch8SaveHandler.call(this, event);
    };
  }

  // Make Scan Image use the standards picker route too. It already counts every
  // chosen image as scan evidence in Patch 8.
  const scanImageInput = byId('scanImageInput');
  if (scanImageInput) {
    makePickerRenderable(scanImageInput);
    scanImageInput.addEventListener('cancel', resetNativeCaptureBusy);
  }
  if (byId('scanImageBtn')) {
    byId('scanImageBtn').onclick = () => {
      resetNativeCaptureBusy();
      releaseScannerForNativeCapture();
      try { scanImageInput.value = ''; } catch (_) {}
      makePickerRenderable(scanImageInput);
      try {
        if (typeof scanImageInput.showPicker === 'function') scanImageInput.showPicker();
        else scanImageInput.click();
      } catch (error) {
        try { scanImageInput.click(); }
        catch (_) { toast('Image picker could not open. Reload Safari and try again.', 4500); }
      }
    };
  }

  // Pre-warm once after login/page load when online, without touching camera.
  setTimeout(() => {
    if (navigator.onLine && typeof nativeScannerClass === 'function' && !nativeScannerClass()) {
      prewarmScannerDecoder();
    }
  }, 1200);
})();
