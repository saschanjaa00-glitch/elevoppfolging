// Behaviour for the teacher-matrix print window. Loaded as an external script so the
// production Content-Security-Policy can forbid inline scripts and inline event handlers.
(function () {
'use strict';

function buildScheduleClipboardHtml(table) {
  var clone = table.cloneNode(true);
  clone.setAttribute('border', '1');
  clone.style.borderCollapse = 'collapse';
  clone.removeAttribute('style');
  if (table.className.indexOf('hide-paren') >= 0) {
    var hidden = clone.querySelectorAll('.paren');
    for (var h = hidden.length - 1; h >= 0; h -= 1) {
      hidden[h].parentNode.removeChild(hidden[h]);
    }
  }
  if (table.className.indexOf('hide-collisions') >= 0) {
    var collisionSummaries = clone.querySelectorAll('.schedule-collision-summary');
    for (var c = collisionSummaries.length - 1; c >= 0; c -= 1) {
      collisionSummaries[c].parentNode.removeChild(collisionSummaries[c]);
    }
  }
  var slanted = clone.querySelectorAll('th.slant');
  for (var s = 0; s < slanted.length; s += 1) {
    slanted[s].textContent = slanted[s].textContent.trim();
    slanted[s].className = '';
  }
  var spacers = clone.querySelectorAll('.spacer');
  for (var p = spacers.length - 1; p >= 0; p -= 1) {
    spacers[p].parentNode.removeChild(spacers[p]);
  }
  var cells = clone.querySelectorAll('th, td');
  for (var i = 0; i < cells.length; i += 1) {
    cells[i].style.border = '1px solid #000';
    cells[i].style.padding = '4px 6px';
    cells[i].style.verticalAlign = 'top';
    cells[i].style.fontFamily = 'Calibri, Arial, sans-serif';
    cells[i].style.fontSize = '10pt';
  }
  var lists = clone.querySelectorAll('ul');
  for (var j = 0; j < lists.length; j += 1) {
    lists[j].style.margin = '2px 0 0 14px';
    lists[j].style.padding = '0';
  }
  return '<meta charset="utf-8">' + clone.outerHTML;
}

function buildScheduleClipboardText(table) {
  var lines = [];
  var rows = table.querySelectorAll('tr');
  for (var i = 0; i < rows.length; i += 1) {
    var cells = rows[i].querySelectorAll('th, td');
    var values = [];
    for (var j = 0; j < cells.length; j += 1) {
      if (cells[j].className.indexOf('spacer') >= 0) continue;
      values.push((cells[j].innerText || cells[j].textContent || '').replace(/\s*\n\s*/g, '; ').trim());
    }
    lines.push(values.join('\t'));
  }
  return lines.join('\n');
}

function readTableMatrix(table) {
  var matrix = [];
  var rows = table.querySelectorAll('tr');
  for (var i = 0; i < rows.length; i += 1) {
    var cells = rows[i].querySelectorAll('th, td');
    var values = [];
    for (var j = 0; j < cells.length; j += 1) {
      var cell = cells[j];
      if (cell.className.indexOf('spacer') >= 0) continue;
      var items = cell.querySelectorAll('li');
      if (items.length > 0) {
        var parts = [];
        var heading = cell.querySelector('strong');
        if (heading) parts.push((heading.innerText || heading.textContent || '').trim());
        for (var k = 0; k < items.length; k += 1) {
          parts.push((items[k].innerText || items[k].textContent || '').trim());
        }
        values.push(parts.join('\n'));
      } else {
        values.push((cell.innerText || cell.textContent || '').replace(/\s*\n\s*/g, '\n').trim());
      }
    }
    matrix.push(values);
  }
  return matrix;
}

function copyScheduleTable(button, tableId) {
  var table = document.getElementById(tableId);
  if (!table) return;
  var html = buildScheduleClipboardHtml(table);
  var text = buildScheduleClipboardText(table);
  var originalLabel = button.getAttribute('data-label') || button.textContent;
  button.setAttribute('data-label', originalLabel);

  function done(ok) {
    button.textContent = ok ? 'Kopiert!' : 'Kopiering feilet';
    setTimeout(function () { button.textContent = originalLabel; }, 2000);
  }

  function fallback() {
    try {
      var selection = window.getSelection();
      var range = document.createRange();
      range.selectNode(table);
      selection.removeAllRanges();
      selection.addRange(range);
      var ok = document.execCommand('copy');
      selection.removeAllRanges();
      done(ok);
    } catch (error) {
      done(false);
    }
  }

  function copyViaEvent() {
    var written = false;
    function onCopy(event) {
      if (!event.clipboardData) return;
      event.clipboardData.setData('text/html', html);
      event.clipboardData.setData('text/plain', text);
      event.preventDefault();
      written = true;
    }
    document.addEventListener('copy', onCopy);
    try {
      document.execCommand('copy');
    } catch (error) {
      written = false;
    } finally {
      document.removeEventListener('copy', onCopy);
    }
    return written;
  }

  // setData() stores the HTML as-is; the async Clipboard API re-parses it in this
  // document, which makes the CSP report every inline style attribute.
  if (copyViaEvent()) {
    done(true);
    return;
  }

  if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
    var item = new window.ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' })
    });
    navigator.clipboard.write([item]).then(function () { done(true); }, fallback);
    return;
  }
  fallback();
}

function toggleMeetingCounts(checkbox) {
  var show = checkbox.checked;
  var cells = document.querySelectorAll('#teacher-meeting-table .meeting-cell[data-plain]');
  for (var i = 0; i < cells.length; i += 1) {
    cells[i].textContent = show
      ? cells[i].getAttribute('data-count')
      : cells[i].getAttribute('data-plain');
  }
}

function toggleParentheses(checkbox, tableId) {
  var table = document.getElementById(tableId);
  if (!table) return;
  if (checkbox.checked) {
    table.className = table.className.replace(/\s*hide-paren/g, '');
  } else if (table.className.indexOf('hide-paren') < 0) {
    table.className += ' hide-paren';
  }
}

function syncLabel(source) {
  var group = source.getAttribute('data-sync-group');
  var index = source.getAttribute('data-sync-index');
  if (group === null || index === null) return;
  var text = (source.innerText || source.textContent || '').replace(/\s+/g, ' ').trim();
  var selector = '[data-sync-group="' + group + '"][data-sync-index="' + index + '"]';
  var targets = document.querySelectorAll(selector);
  for (var i = 0; i < targets.length; i += 1) {
    if (targets[i] === source) continue;
    targets[i].textContent = text;
  }
}

function toggleCollisions(checkbox) {
  var table = document.getElementById('discussion-schedule-table');
  if (!table) return;
  if (checkbox.checked) {
    table.className = table.className.replace(/\s*hide-collisions/g, '');
  } else if (table.className.indexOf('hide-collisions') < 0) {
    table.className += ' hide-collisions';
  }
}

function toggleAnonymous(checkbox) {
  var anonymous = checkbox.checked;
  var names = document.querySelectorAll('.pname');
  for (var i = 0; i < names.length; i += 1) {
    names[i].textContent = anonymous
      ? names[i].getAttribute('data-anon')
      : names[i].getAttribute('data-real');
  }
}

function exportTableToExcel(button, tableId, filenameBase) {
  var table = document.getElementById(tableId);
  if (!table || typeof window.buildTableWorkbook !== 'function') return;
  var originalLabel = button.getAttribute('data-label') || button.textContent;
  button.setAttribute('data-label', originalLabel);
  button.textContent = 'Lager Excel …';
  window.buildTableWorkbook(readTableMatrix(table), filenameBase).then(function (download) {
    var link = document.createElement('a');
    link.href = download.url;
    link.download = download.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(download.url); }, 10000);
    button.textContent = 'Lastet ned!';
    setTimeout(function () { button.textContent = originalLabel; }, 2000);
  }, function () {
    button.textContent = 'Eksport feilet';
    setTimeout(function () { button.textContent = originalLabel; }, 2000);
  });
}

document.addEventListener('paste', function (event) {
  var target = event.target;
  if (!target || !target.className || String(target.className).indexOf('editable-label') < 0) return;
  event.preventDefault();
  var clipboard = event.clipboardData || window.clipboardData;
  var text = clipboard ? clipboard.getData('text') : '';
  document.execCommand('insertText', false, text.replace(/\s+/g, ' ').trim());
  syncLabel(target);
});

function clearSinglePrint() {
  var marked = document.querySelectorAll('.print-hidden, .print-path');
  for (var i = 0; i < marked.length; i += 1) {
    marked[i].classList.remove('print-hidden', 'print-path');
  }
}

// Prints one table (with its heading and description) by hiding every other branch of the page.
function printTable(tableId) {
  var table = document.getElementById(tableId);
  var block = table && table.closest('.table-block');
  if (!block) return;
  clearSinglePrint();
  for (var node = block; node && node !== document.body; node = node.parentElement) {
    node.classList.add('print-path');
    var siblings = node.parentElement ? node.parentElement.children : [];
    for (var i = 0; i < siblings.length; i += 1) {
      if (siblings[i] !== node && siblings[i].tagName !== 'SCRIPT' && !siblings[i].classList.contains('doc-meta')) {
        siblings[i].classList.add('print-hidden');
      }
    }
  }
  window.addEventListener('afterprint', clearSinglePrint, { once: true });
  window.print();
}

document.addEventListener('click', function (event) {
  var button = event.target && event.target.closest ? event.target.closest('button[data-action]') : null;
  if (!button) return;
  var action = button.getAttribute('data-action');
  var tableId = button.getAttribute('data-table');
  if (action === 'print') {
    clearSinglePrint();
    window.print();
  }
  else if (action === 'print-table') printTable(tableId);
  else if (action === 'copy-table') copyScheduleTable(button, tableId);
  else if (action === 'export-excel') exportTableToExcel(button, tableId, button.getAttribute('data-filename'));
});

document.addEventListener('change', function (event) {
  var checkbox = event.target;
  if (!checkbox || !checkbox.getAttribute) return;
  var action = checkbox.getAttribute('data-action');
  if (action === 'toggle-anonymous') toggleAnonymous(checkbox);
  else if (action === 'toggle-collisions') toggleCollisions(checkbox);
  else if (action === 'toggle-parentheses') toggleParentheses(checkbox, checkbox.getAttribute('data-table'));
  else if (action === 'toggle-meeting-counts') toggleMeetingCounts(checkbox);
});

document.addEventListener('input', function (event) {
  var target = event.target;
  if (target && target.classList && target.classList.contains('editable-label')) syncLabel(target);
});

// Column widths are passed as data attributes and applied via CSSOM, which CSP allows.
var sizedTables = document.querySelectorAll('table[data-col-width]');
for (var t = 0; t < sizedTables.length; t += 1) {
  sizedTables[t].style.setProperty('--col-width', sizedTables[t].getAttribute('data-col-width'));
}
})();
