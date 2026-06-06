/* ===== Readable source — Online tudástár videó-letöltő =====
   A videók forrása a lejátszóból visszafejtve:
     index.php?module=videos&todo=lessons&action=str&ajax=1&course_id=X&video_id=Y
   Ez maga a videófájl-stream (a <source src> erre mutat).
   A ZIP-et StreamSaver + client-zip streameli a lemezre, így nagy
   összméretnél sem fogy el a memória. */
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

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

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

  async function main() {
    ui.msg('Loading…');
    await loadScript('https://cdn.jsdelivr.net/npm/streamsaver@2.0.6/StreamSaver.min.js');
    var mod = await import('https://cdn.jsdelivr.net/npm/client-zip/index.js');
    var downloadZip = mod.downloadZip;

    var items = collect();
    if (!items.length) { ui.msg('Nincs videó ezen az oldalon.', '#b00'); ui.done(); return; }

    var total = items.length, done = 0, failed = 0, bytes = 0, used = {}, tick = 0;
    function status(idx, it) {
      ui.msg('(' + idx + '/' + total + ') ' + it.course + '\n' + it.name + '\n' + fmt(bytes) + ' letöltve' + (failed ? ('  ·  ' + failed + ' hiba') : ''));
    }

    async function* gen() {
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var url = 'index.php?module=videos&todo=lessons&action=str&ajax=1&course_id=' + it.cid + '&video_id=' + it.vid;
        status(i + 1, it);
        var res;
        try {
          res = await fetch(url, { credentials: 'include' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
        } catch (e) {
          failed++; console.warn('[zip-vid] hiba video_id ' + it.vid + ': ' + e.message); continue;
        }
        var ext = extFromType(res.headers.get('content-type'));
        var path = it.course + '/' + it.name + '.' + ext;
        if (used[path]) path = it.course + '/' + it.name + '_' + it.vid + '.' + ext;
        used[path] = true;

        var counted = res.body.pipeThrough(new TransformStream({
          transform: function (chunk, ctrl) {
            bytes += chunk.byteLength;
            if ((tick++ & 31) === 0) status(i + 1, it);
            ctrl.enqueue(chunk);
          }
        }));
        done++;
        console.log('[zip-vid] ' + (i + 1) + '/' + total + ': ' + path);
        yield { name: path, input: counted };
      }
    }

    var zipResponse = downloadZip(gen());
    var fileStream = window.streamSaver.createWriteStream('online-tudastar.zip');
    await zipResponse.body.pipeTo(fileStream);

    ui.msg('✓ Kész: ' + done + '/' + total + ' videó (' + fmt(bytes) + ')' + (failed ? ('\n' + failed + ' hiba — lásd konzol') : ''), failed ? '#c47f00' : '#2e7d32');
    ui.done();
  }

  main().catch(function (e) { ui.msg('Hiba: ' + e.message, '#b00'); ui.done(); });
})();
