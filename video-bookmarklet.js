/* ===== Readable source — Online tudástár videó-letöltő =====
   A videók forrása a lejátszóból visszafejtve:
     index.php?module=videos&todo=lessons&action=str&ajax=1&course_id=X&video_id=Y
   Ez maga a videófájl-stream (a <source src> erre mutat).
   A ZIP-et a File System Access API (showSaveFilePicker) + client-zip
   streameli egyenesen a lemezre, így nagy összméretnél sem fogy el a
   memória — és nincs StreamSaver/MessageChannel, amit a böngésző-
   bővítmények el tudnának rontani. (Chrome/Edge szükséges.) */
(function () {
  function clean(s) {
    return (s || '')
      .replace(/ /g, ' ')
      .replace(/[\/\\:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim() || 'untitled';
  }

  function fmt(b) {
    if (b > 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
    if (b > 1048576) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1024).toFixed(0) + ' KB';
  }

  function extFromType(ct) {
    ct = (ct || '').toLowerCase();
    if (ct.indexOf('mp4') >= 0) return 'mp4';
    if (ct.indexOf('webm') >= 0) return 'webm';
    if (ct.indexOf('quicktime') >= 0 || ct.indexOf('mov') >= 0) return 'mov';
    if (ct.indexOf('matroska') >= 0) return 'mkv';
    if (ct.indexOf('ogg') >= 0) return 'ogv';
    if (ct.indexOf('mp3') >= 0 || ct.indexOf('mpeg') >= 0) return 'mp3';
    return 'mp4';
  }

  // on-screen notification box (bottom-right)
  var ui = (function () {
    var box = document.getElementById('zipvid-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'zipvid-toast';
      box.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;' +
        'min-width:260px;max-width:360px;background:#1769aa;color:#fff;' +
        'font:13px/1.5 system-ui,sans-serif;padding:14px 16px;border-radius:8px;' +
        'box-shadow:0 6px 24px rgba(0,0,0,.3);white-space:pre-line';
      document.body.appendChild(box);
    }
    return {
      msg: function (t, color) { box.textContent = t; if (color) box.style.background = color; },
      done: function () { setTimeout(function () { box.remove(); }, 8000); }
    };
  })();

  function collect() {
    var items = [];
    document.querySelectorAll('.frame_right_box').forEach(function (box) {
      var t = box.querySelector('.title');
      var course = clean(t ? t.textContent : '');
      box.querySelectorAll('.video_item').forEach(function (vi) {
        var cid = vi.getAttribute('data-course_id');
        var vid = vi.getAttribute('data-video_id');
        if (!cid || !vid) return;
        var vt = vi.querySelector('.title');
        items.push({ course: course, cid: cid, vid: vid, name: clean(vt ? vt.textContent : 'video-' + vid) });
      });
    });
    return items;
  }

  function videoUrl(it) {
    return 'index.php?module=videos&todo=lessons&action=str&ajax=1&course_id=' + it.cid + '&video_id=' + it.vid;
  }

  // shared progress state
  var total = 0, done = 0, failed = 0, bytes = 0, tick = 0, used = {};
  function status(label) {
    ui.msg(label + '\n' + done + '/' + total + ' kész · ' + fmt(bytes) + (failed ? ('  ·  ' + failed + ' hiba') : ''));
  }
  function pathFor(it, ct) {
    var ext = extFromType(ct);
    var p = it.course + '/' + it.name + '.' + ext;
    if (used[p]) p = it.course + '/' + it.name + '_' + it.vid + '.' + ext;
    used[p] = true;
    return p;
  }
  // wrap a response body so downloaded bytes update the toast live
  function counted(res, it) {
    return res.body.pipeThrough(new TransformStream({
      transform: function (chunk, ctrl) {
        bytes += chunk.byteLength;
        if ((tick++ & 31) === 0) status(it.course + ' / ' + it.name);
        ctrl.enqueue(chunk);
      }
    }));
  }

  // MODE A — single ZIP streamed straight to disk (Chrome/Edge, or Brave with the flag)
  async function streamToDisk(items, downloadZip) {
    var handle = window.__zipvid_handle, writable = await handle.createWritable();
    async function* gen() {
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        status(it.course + ' / ' + it.name);
        var res;
        try { res = await fetch(videoUrl(it), { credentials: 'include' }); if (!res.ok) throw new Error('HTTP ' + res.status); }
        catch (e) { failed++; console.warn('[zip-vid] hiba video_id ' + it.vid + ': ' + e.message); continue; }
        var name = pathFor(it, res.headers.get('content-type'));
        done++;
        console.log('[zip-vid] ' + (i + 1) + '/' + total + ': ' + name);
        yield { name: name, input: counted(res, it) };
      }
    }
    await downloadZip(gen()).body.pipeTo(writable);
    ui.msg('✓ Kész: ' + done + '/' + total + ' videó (' + fmt(bytes) + ')' + (failed ? ('\n' + failed + ' hiba — lásd konzol') : ''), failed ? '#c47f00' : '#2e7d32');
    ui.done();
  }

  // MODE B — fallback: one in-memory ZIP per course, downloaded via <a> (works in Brave, no flag)
  async function perCourseBlobs(items, downloadZip) {
    var courses = {}, order = [];
    items.forEach(function (it) { if (!courses[it.course]) { courses[it.course] = []; order.push(it.course); } courses[it.course].push(it); });
    for (var c = 0; c < order.length; c++) {
      var course = order[c], list = courses[course], files = [];
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        status('[' + (c + 1) + '/' + order.length + ' kurzus] ' + it.course + ' / ' + it.name);
        var res;
        try { res = await fetch(videoUrl(it), { credentials: 'include' }); if (!res.ok) throw new Error('HTTP ' + res.status); }
        catch (e) { failed++; console.warn('[zip-vid] hiba video_id ' + it.vid + ': ' + e.message); continue; }
        var name = pathFor(it, res.headers.get('content-type'));
        files.push({ name: name.split('/').pop(), input: counted(res, it) });
        done++;
      }
      if (!files.length) continue;
      status('ZIP készítése: ' + course + '…');
      var blob = await downloadZip(files).blob();
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'online-tudastar - ' + course + '.zip';
      document.body.appendChild(a); a.click();
      setTimeout((function (u, el) { return function () { URL.revokeObjectURL(u); el.remove(); }; })(a.href, a), 4000);
    }
    ui.msg('✓ Kész: ' + done + '/' + total + ' videó, ' + order.length + ' ZIP (' + fmt(bytes) + ')' + (failed ? ('\n' + failed + ' hiba — lásd konzol') : ''), failed ? '#c47f00' : '#2e7d32');
    ui.done();
  }

  async function main() {
    var items = collect();
    if (!items.length) { ui.msg('Nincs videó ezen az oldalon.', '#b00'); ui.done(); return; }
    total = items.length;

    // Ha van File System Access API: a mentési ablakot a kattintás gesztusán belül,
    // MINDEN await ELŐTT kell megnyitni, különben elveszik a felhasználói aktiválás.
    var streaming = !!window.showSaveFilePicker;
    if (streaming) {
      window.__zipvid_handle = await window.showSaveFilePicker({
        suggestedName: 'online-tudastar.zip',
        types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }]
      });
    }

    ui.msg('Loading…');
    var mod = await import('https://cdn.jsdelivr.net/npm/client-zip/index.js');
    var downloadZip = mod.downloadZip;

    if (streaming) return streamToDisk(items, downloadZip);
    return perCourseBlobs(items, downloadZip);
  }

  main().catch(function (e) {
    if (e && e.name === 'AbortError') { ui.msg('Megszakítva.', '#7a8794'); ui.done(); return; }
    ui.msg('Hiba: ' + (e && e.message || e), '#b00'); ui.done();
  });
})();
