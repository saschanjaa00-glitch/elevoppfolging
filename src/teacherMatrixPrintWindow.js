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
  var marked = document.querySelectorAll('.print-hidden, .print-path, .print-first');
  for (var i = 0; i < marked.length; i += 1) {
    marked[i].classList.remove('print-hidden', 'print-path', 'print-first');
  }
}

function isBlockPrinted(block) {
  if (block.closest('.print-hidden')) return false;
  if (block.classList.contains('print-path')) return true;
  var tab = block.getAttribute('data-tab');
  return !tab || tab === document.body.getAttribute('data-active-tab');
}

// Every table block starts on a new page; the first one that is printed must not, or page 1 is blank.
function markFirstPrintedBlock() {
  var previous = document.querySelectorAll('.print-first');
  for (var p = 0; p < previous.length; p += 1) previous[p].classList.remove('print-first');
  var blocks = document.querySelectorAll('.table-block');
  for (var i = 0; i < blocks.length; i += 1) {
    if (isBlockPrinted(blocks[i])) {
      blocks[i].classList.add('print-first');
      return;
    }
  }
}

function selectTab(tab) {
  document.body.setAttribute('data-active-tab', tab);
  var buttons = document.querySelectorAll('.tab-bar button[data-tab]');
  for (var i = 0; i < buttons.length; i += 1) {
    buttons[i].setAttribute('aria-selected', buttons[i].getAttribute('data-tab') === tab ? 'true' : 'false');
  }
}

// Prints the given table blocks (with headings and descriptions) by hiding every other branch of the page.
function printBlocks(blocks) {
  if (blocks.length === 0) return;
  clearSinglePrint();
  for (var b = 0; b < blocks.length; b += 1) {
    for (var node = blocks[b]; node && node !== document.body; node = node.parentElement) {
      node.classList.add('print-path');
    }
  }
  var paths = document.querySelectorAll('.print-path');
  for (var p = 0; p < paths.length; p += 1) {
    var siblings = paths[p].parentElement ? paths[p].parentElement.children : [];
    for (var i = 0; i < siblings.length; i += 1) {
      var sibling = siblings[i];
      if (sibling.classList.contains('print-path') || sibling.tagName === 'SCRIPT' || sibling.classList.contains('doc-meta')) continue;
      sibling.classList.add('print-hidden');
    }
  }
  markFirstPrintedBlock();
  window.addEventListener('afterprint', clearSinglePrint, { once: true });
  window.print();
}

function printTable(tableId) {
  var table = document.getElementById(tableId);
  var block = table && table.closest('.table-block');
  if (block) printBlocks([block]);
}

function buildPrintPanel(panel) {
  var blocks = document.querySelectorAll('.table-block[data-print-group]');
  var groups = [];
  var byName = {};
  for (var i = 0; i < blocks.length; i += 1) {
    var name = blocks[i].getAttribute('data-print-group');
    if (!byName[name]) {
      byName[name] = { name: name, items: [] };
      groups.push(byName[name]);
    }
    byName[name].items.push(blocks[i]);
  }

  var list = document.createElement('div');
  list.className = 'print-panel-groups';
  groups.forEach(function (group) {
    var fieldset = document.createElement('fieldset');
    fieldset.className = 'print-panel-group';
    var legend = document.createElement('legend');
    var groupLabel = document.createElement('label');
    var groupBox = document.createElement('input');
    groupBox.type = 'checkbox';
    groupBox.checked = true;
    groupBox.setAttribute('data-print-group-toggle', '');
    groupLabel.appendChild(groupBox);
    groupLabel.appendChild(document.createTextNode(' ' + group.name));
    legend.appendChild(groupLabel);
    fieldset.appendChild(legend);
    group.items.forEach(function (block) {
      var label = document.createElement('label');
      label.className = 'print-panel-item';
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = true;
      box.setAttribute('data-print-item', '');
      box.printBlock = block;
      label.appendChild(box);
      label.appendChild(document.createTextNode(' ' + block.getAttribute('data-print-label')));
      fieldset.appendChild(label);
    });
    list.appendChild(fieldset);
  });

  var actions = document.createElement('div');
  actions.className = 'print-panel-actions';
  [['print-panel-all', 'Velg alle'], ['print-panel-none', 'Fjern alle'], ['print-selected', 'Skriv ut valgte']].forEach(function (entry) {
    var button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-action', entry[0]);
    button.textContent = entry[1];
    actions.appendChild(button);
  });
  var count = document.createElement('span');
  count.className = 'print-panel-count';
  actions.appendChild(count);

  var hint = document.createElement('p');
  hint.className = 'print-panel-hint';
  hint.textContent = 'Hver tabell skrives ut på egen side.';

  panel.appendChild(list);
  panel.appendChild(actions);
  panel.appendChild(hint);
  updatePrintPanel(panel);
}

function updatePrintPanel(panel) {
  var fieldsets = panel.querySelectorAll('.print-panel-group');
  for (var f = 0; f < fieldsets.length; f += 1) {
    var items = fieldsets[f].querySelectorAll('input[data-print-item]');
    var checked = 0;
    for (var i = 0; i < items.length; i += 1) if (items[i].checked) checked += 1;
    var groupBox = fieldsets[f].querySelector('input[data-print-group-toggle]');
    groupBox.checked = checked === items.length;
    groupBox.indeterminate = checked > 0 && checked < items.length;
  }
  var selected = selectedPrintBlocks(panel).length;
  panel.querySelector('.print-panel-count').textContent = selected + ' valgt';
  panel.querySelector('button[data-action="print-selected"]').disabled = selected === 0;
}

function selectedPrintBlocks(panel) {
  var boxes = panel.querySelectorAll('input[data-print-item]');
  var blocks = [];
  for (var i = 0; i < boxes.length; i += 1) if (boxes[i].checked) blocks.push(boxes[i].printBlock);
  return blocks;
}

function setAllPrintItems(panel, checked) {
  var boxes = panel.querySelectorAll('input[data-print-item]');
  for (var i = 0; i < boxes.length; i += 1) boxes[i].checked = checked;
  updatePrintPanel(panel);
}

function togglePrintPanel(button) {
  var panel = document.getElementById('print-panel');
  if (!panel) return;
  if (!panel.firstChild) buildPrintPanel(panel);
  panel.hidden = !panel.hidden;
  button.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
}

// Covers Ctrl+P and "Skriv ut / lagre som PDF" as well as the selective prints.
window.addEventListener('beforeprint', markFirstPrintedBlock);

document.addEventListener('click', function (event) {
  var button = event.target && event.target.closest ? event.target.closest('button[data-action]') : null;
  if (!button) return;
  var action = button.getAttribute('data-action');
  var tableId = button.getAttribute('data-table');
  var panel = document.getElementById('print-panel');
  if (action === 'print') {
    clearSinglePrint();
    window.print();
  }
  else if (action === 'print-table') printTable(tableId);
  else if (action === 'select-tab') selectTab(button.getAttribute('data-tab'));
  else if (action === 'toggle-print-panel') togglePrintPanel(button);
  else if (action === 'print-panel-all' && panel) setAllPrintItems(panel, true);
  else if (action === 'print-panel-none' && panel) setAllPrintItems(panel, false);
  else if (action === 'print-selected' && panel) printBlocks(selectedPrintBlocks(panel));
  else if (action === 'copy-table') copyScheduleTable(button, tableId);
  else if (action === 'export-excel') exportTableToExcel(button, tableId, button.getAttribute('data-filename'));
});

document.addEventListener('change', function (event) {
  var checkbox = event.target;
  if (!checkbox || !checkbox.getAttribute) return;
  var panel = checkbox.closest ? checkbox.closest('.print-panel') : null;
  if (panel) {
    if (checkbox.hasAttribute('data-print-group-toggle')) {
      var items = checkbox.closest('.print-panel-group').querySelectorAll('input[data-print-item]');
      for (var i = 0; i < items.length; i += 1) items[i].checked = checkbox.checked;
    }
    updatePrintPanel(panel);
    return;
  }
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
