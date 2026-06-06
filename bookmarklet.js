/* ===== Readable source ===== */
(function () {
  // sanitize a string so it's a safe folder/file name
  function clean(s) {
    return (s || '')
      .replace(/ /g, ' ')           // nbsp -> space
      .replace(/[\/\\:*?"<>|]/g, '-')     // illegal path chars
      .replace(/\s+/g, ' ')
      .trim() || 'untitled';
  }

  // on-screen notification box (bottom-right)
  var ui = (function () {
    var box = document.getElementById('zipdocs-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'zipdocs-toast';
      box.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;' +
        'min-width:240px;max-width:340px;background:#1769aa;color:#fff;' +
        'font:14px/1.45 system-ui,sans-serif;padding:14px 16px;border-radius:8px;' +
        'box-shadow:0 6px 24px rgba(0,0,0,.3);white-space:pre-line';
      document.body.appendChild(box);
    }
    return {
      msg: function (t, color) { box.textContent = t; if (color) box.style.background = color; },
      done: function () { setTimeout(function () { box.remove(); }, 6000); }
    };
  })();

  // load JSZip from CDN (once)
  function loadJSZip() {
    return new Promise(function (resolve, reject) {
      if (window.JSZip) return resolve(window.JSZip);
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = function () { resolve(window.JSZip); };
      s.onerror = function () { reject(new Error('Could not load JSZip')); };
      document.head.appendChild(s);
    });
  }

  // collect { folder, id, filename } for every download link on the page
  function collect() {
    var items = [];
    document.querySelectorAll('.frame_right_box').forEach(function (box) {
      var titleEl = box.querySelector('.title');
      var folder = clean(titleEl ? titleEl.textContent : '');

      box.querySelectorAll('tr.data_row_datas').forEach(function (row) {
        var link = row.querySelector('a[onclick*="todo=download"]');
        if (!link) return;
        var m = (link.getAttribute('onclick') || '').match(/id=(\d+)/);
        if (!m) return;
        var id = m[1];

        // find the real filename ("Fájlnév:" row), else fall back to id
        var filename = '';
        row.querySelectorAll('tr').forEach(function (r) {
          var left = r.querySelector('.left_cell');
          if (left && /F.jln.v/i.test(left.textContent)) {
            var cells = r.querySelectorAll('td');
            if (cells[1]) filename = clean(cells[1].textContent);
          }
        });
        if (!filename) filename = 'file-' + id;

        items.push({ folder: folder, id: id, filename: filename });
      });
    });
    return items;
  }

  function fetchBlob(id) {
    var url = 'index.php?module=library&todo=download&id=' + id;
    return fetch(url, { credentials: 'include' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for id ' + id);
      return res.blob();
    });
  }

  ui.msg('Loading JSZip…');
  loadJSZip().then(function (JSZip) {
    var items = collect();
    if (!items.length) { ui.msg('No download links found on this page.', '#b00'); ui.done(); return; }

    var zip = new JSZip();
    var used = {};                 // avoid collisions within a folder
    var done = 0, failed = 0;
    var total = items.length;
    console.log('[zip-docs] found ' + total + ' files, downloading...');

    // download sequentially to be gentle on the server
    var chain = Promise.resolve();
    items.forEach(function (it) {
      chain = chain.then(function () {
        return fetchBlob(it.id).then(function (blob) {
          var key = it.folder + '/' + it.filename;
          if (used[key]) { it.filename = it.id + '_' + it.filename; }
          used[it.folder + '/' + it.filename] = true;
          zip.folder(it.folder).file(it.filename, blob);
          done++;
          ui.msg('Downloading… ' + (done + failed) + '/' + total + (failed ? ('\n' + failed + ' failed') : ''));
          console.log('[zip-docs] ' + (done + failed) + '/' + total + ' ok: ' + key);
        }).catch(function (e) {
          failed++;
          ui.msg('Downloading… ' + (done + failed) + '/' + total + '\n' + failed + ' failed');
          console.warn('[zip-docs] failed id ' + it.id + ': ' + e.message);
        });
      });
    });

    chain.then(function () {
      ui.msg('Zipping ' + done + ' files…');
      console.log('[zip-docs] zipping ' + done + ' files (' + failed + ' failed)...');
      return zip.generateAsync({ type: 'blob' });
    }).then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'dokumentumok.zip';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      ui.msg('✓ Done: ' + done + ' files zipped' + (failed ? ('\n' + failed + ' failed (see console)') : ''), failed ? '#c47f00' : '#2e7d32');
      ui.done();
    });
  }).catch(function (e) {
    ui.msg('Error: ' + e.message, '#b00');
    ui.done();
  });
})();
