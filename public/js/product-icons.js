/* Automatic isometric product icons for POS and inventory surfaces.
   Every icon is a self-contained inline SVG: no uploads, no text, no network. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ProductIcons = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function icon(body) {
    return '<svg viewBox="0 0 32 32" focusable="false" aria-hidden="true">' + body + '</svg>';
  }

  var ICONS = {
    bottle: icon(
      '<ellipse class="pi-shadow" cx="16" cy="29" rx="8" ry="2.2"/>' +
      '<rect class="pi-b" x="13" y="2" width="6" height="3" rx="1"/>' +
      '<path class="pi-d" d="M14 5h4v3h-4z" opacity=".65"/>' +
      '<path class="pi-a" d="M12 9h8l1 3v14a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3V12z"/>' +
      '<path class="pi-b" d="M20 9l1 3v14a3 3 0 0 1-3 3h-1V9z"/>' +
      '<path class="pi-d" d="M12 11h8v2h-8z" opacity=".25"/>' +
      '<path class="pi-b" d="M11 17h10v9a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2z"/>' +
      '<path class="pi-l" d="M12 13h8v4h-8z" opacity=".85"/>' +
      '<path class="pi-l" d="M13 18h2v5h-2z" opacity=".55"/>' +
      '<circle class="pi-l" cx="15" cy="21" r=".7" opacity=".8"/>' +
      '<circle class="pi-l" cx="18" cy="24" r=".55" opacity=".7"/>' +
      '<path class="pi-s" d="M13 2h6M14 5v4M18 5v4M12 9h8M11 12v14M21 12v14M11 24h10"/>'
    ),
    can: icon(
      '<ellipse class="pi-shadow" cx="16" cy="29" rx="7.5" ry="2"/>' +
      '<ellipse class="pi-l" cx="16" cy="6.5" rx="7" ry="2.6"/>' +
      '<path class="pi-a" d="M9 6.5v17c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7v-17c0 1.5-3.1 2.7-7 2.7S9 8 9 6.5z"/>' +
      '<path class="pi-b" d="M20 7.3v16.2c0 1.2-1.8 2.3-4 2.6V7.3c2 0 4-.2 4-.2z"/>' +
      '<path class="pi-f" d="M9 12h14v7H9z"/>' +
      '<path class="pi-l" d="M11 13h3v5h-3z" opacity=".45"/>' +
      '<ellipse class="pi-s" cx="16" cy="6.5" rx="5" ry="1.6"/>' +
      '<ellipse class="pi-s" cx="17" cy="6" rx="1.4" ry=".7"/>' +
      '<path class="pi-s" d="M14 5.5h4M9 19h14M13.5 5.6v1.8M18.5 5.6v1.8"/>' +
      '<circle class="pi-l" cx="14" cy="15" r=".8" opacity=".8"/>' +
      '<circle class="pi-l" cx="18" cy="17" r=".6" opacity=".7"/>'
    ),
    tin: icon(
      '<ellipse class="pi-shadow" cx="16" cy="27" rx="9" ry="2.2"/>' +
      '<ellipse class="pi-l" cx="16" cy="8.5" rx="8" ry="3"/>' +
      '<path class="pi-a" d="M8 8.5v11c0 1.7 3.6 3 8 3s8-1.3 8-3v-11c0 1.7-3.6 3-8 3S8 10.2 8 8.5z"/>' +
      '<path class="pi-b" d="M21 9.1v10.6c0 1.2-2.2 2.3-5 2.7V9.1c2.8 0 5-.2 5-.2z"/>' +
      '<path class="pi-m" d="M8 13h16v5H8z"/>' +
      '<path class="pi-l" d="M10 15.5c2-1.5 5-1.5 7 0-2 1.5-5 1.5-7 0z" opacity=".9"/>' +
      '<path class="pi-l" d="M17 15.5l2-1.5v3z" opacity=".9"/>' +
      '<circle class="pi-d" cx="12" cy="15.2" r=".4"/>' +
      '<ellipse class="pi-s" cx="16" cy="8.5" rx="5" ry="1.6"/>' +
      '<path class="pi-s" d="M8 15h16M8 18h16M22.5 7.2c.8.3 1.2.8 1.2 1.3M19 8.5h2"/>'
    ),
    cologne: icon(
      '<ellipse class="pi-shadow" cx="16" cy="28" rx="7" ry="2"/>' +
      '<rect class="pi-d" x="15" y="2" width="4" height="2" rx=".6"/>' +
      '<path class="pi-b" d="M19 3h4v2h-2v3h-2z"/>' +
      '<path class="pi-h" d="M11 8h10l2 4v13a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V12z"/>' +
      '<path class="pi-b" d="M19 8l2 4v13a2 2 0 0 1-2 2h-2V8z" opacity=".45"/>' +
      '<path class="pi-l" d="M10 13h12v6H10z" opacity=".9"/>' +
      '<path class="pi-h" d="M12 15h8v2h-8z" opacity=".8"/>' +
      '<path class="pi-c" d="M8 8l1-2 1 2-1 2zM5 12l.8-1.5.8 1.5-.8 1.5z"/>' +
      '<circle class="pi-c" cx="9" cy="6" r=".7"/>' +
      '<circle class="pi-c" cx="6" cy="10" r=".5"/>' +
      '<path class="pi-s" d="M14 3h4M12 11h8M12 19h8M11 8v15M21 8v15"/>'
    ),
    detergent: icon(
      '<ellipse class="pi-shadow" cx="16" cy="29" rx="10" ry="2.2"/>' +
      '<path class="pi-l" d="M7 9l9-5 9 5-9 5z"/>' +
      '<path class="pi-a" d="M7 9l9 5v14l-9-5z"/>' +
      '<path class="pi-b" d="M25 9l-9 5v14l9-5z"/>' +
      '<path class="pi-i" d="M9 14l7 4v7l-7-4z" opacity=".9"/>' +
      '<path class="pi-m" d="M9 20l7 4v3l-7-4z" opacity=".8"/>' +
      '<ellipse class="pi-c" cx="22" cy="8" rx="3" ry="1.4"/>' +
      '<path class="pi-c" d="M19 8v2c0 .8 1.3 1.4 3 1.4s3-.6 3-1.4V8"/>' +
      '<path class="pi-c" d="M22 4v3" opacity=".8"/>' +
      '<circle class="pi-l" cx="10" cy="11" r="1"/>' +
      '<circle class="pi-l" cx="12" cy="8" r=".7"/>' +
      '<circle class="pi-l" cx="8" cy="8" r=".6"/>' +
      '<path class="pi-s" d="M7 9l9 5 9-5M16 14v14M9 14l7 4 7-4M19 8v2"/>'
    ),
    wipes: icon(
      '<ellipse class="pi-shadow" cx="16" cy="29" rx="10" ry="2.2"/>' +
      '<path class="pi-l" d="M6 12l10-5 10 5-10 5z"/>' +
      '<path class="pi-a" d="M6 12l10 5v12l-10-5z"/>' +
      '<path class="pi-b" d="M26 12l-10 5v12l10-5z"/>' +
      '<path class="pi-i" d="M9 14l6 3v3l-6-3z" opacity=".9"/>' +
      '<path class="pi-m" d="M12 7c1.5 0 3 .6 4 1.7l1.5 2-2.5 1.5-2-2.2C12 9.2 11.5 8.2 12 7z"/>' +
      '<path class="pi-l" d="M13 5c1.5-.5 3-.2 4 .7l2 2-2 1.8-2.2-2.1C13.8 6.5 13 5.7 13 5z"/>' +
      '<path class="pi-c" d="M20 8l.6-1.2.6 1.2 1.2.6-1.2.6-.6 1.2-.6-1.2-1.2-.6z"/>' +
      '<path class="pi-s" d="M6 12l10 5 10-5M16 17v12M9 14l6 3 6-3M13 5c1 1 2 2 3 2"/>'
    ),
    acne: icon(
      '<ellipse class="pi-shadow" cx="16" cy="27" rx="9" ry="2.2"/>' +
      '<ellipse class="pi-l" cx="16" cy="9" rx="8" ry="3"/>' +
      '<path class="pi-a" d="M8 9v10c0 1.7 3.6 3 8 3s8-1.3 8-3V9c0 1.7-3.6 3-8 3S8 10.7 8 9z"/>' +
      '<path class="pi-b" d="M21 9.5v9.6c0 1.2-2.2 2.3-5 2.7V9.5c2.8 0 5-.2 5-.2z"/>' +
      '<path class="pi-i" d="M8.5 13h15v5h-15z" opacity=".95"/>' +
      '<path class="pi-h" d="M10 14h12v2H10z" opacity=".55"/>' +
      '<circle class="pi-b" cx="12" cy="16.5" r=".6"/>' +
      '<circle class="pi-b" cx="15" cy="17" r=".5"/>' +
      '<circle class="pi-b" cx="18" cy="16.3" r=".6"/>' +
      '<circle class="pi-b" cx="20" cy="17.2" r=".45"/>' +
      '<path class="pi-l" d="M18 4.5c2 0 3.5 1 3.5 2.2S20 9 18 9s-3.5-1-3.5-2.3S16 4.5 18 4.5z" opacity=".9"/>' +
      '<path class="pi-s" d="M8 16h16M9 19h14M16 3v3M18 4.5c1 .3 1.5.8 1.5 1.3"/>'
    ),
    skincare: icon(
      '<ellipse class="pi-shadow" cx="16" cy="29" rx="7" ry="2"/>' +
      '<path class="pi-b" d="M18 2h6v2h-3v2h-3z"/>' +
      '<path class="pi-d" d="M21 3h3v2h-3z"/>' +
      '<path class="pi-d" d="M14 5h5v2h-5z"/>' +
      '<path class="pi-i" d="M11 8h10l2 5v13a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V13z"/>' +
      '<path class="pi-n" d="M19 8l2 5v13a2 2 0 0 1-2 2h-2V8z" opacity=".55"/>' +
      '<path class="pi-a" d="M10 14h12v8H10z"/>' +
      '<path class="pi-l" d="M12 15h8v2h-8z" opacity=".7"/>' +
      '<path class="pi-m" d="M12 18c2-1 4 1 6 0s2 0 2 0" opacity=".8"/>' +
      '<path class="pi-s" d="M15 5h4M12 11h8M10 14v8M22 14v8M13 17h6"/>'
    ),
    chocolate: icon(
      '<ellipse class="pi-shadow" cx="16" cy="28" rx="10" ry="2"/>' +
      '<path class="pi-e" d="M6 9l10-5 10 5-10 5z"/>' +
      '<path class="pi-d" d="M6 9l10 5v13l-10-5z"/>' +
      '<path class="pi-e" d="M26 9l-10 5v13l10-5z"/>' +
      '<path class="pi-c" d="M6 14l10 5v6l-10-5z"/>' +
      '<path class="pi-o" d="M26 14l-10 5v6l10-5z"/>' +
      '<path class="pi-l" d="M8 10l7-3.5 7 3.5-7 3.5z" opacity=".25"/>' +
      '<path class="pi-s" d="M6 9l10 5 10-5M16 14v13M11 6.5v7M21 6.5v7M11 16.5l5 2.5M21 16.5l-5 2.5M6 14l10 5 10-5"/>' +
      '<path class="pi-l" d="M8 9.5l3-1.5 3 1.5-3 1.5z" opacity=".35"/>'
    ),
    shampoo: icon(
      '<ellipse class="pi-shadow" cx="16" cy="29" rx="7" ry="2"/>' +
      '<rect class="pi-d" x="12" y="2" width="8" height="2" rx=".8"/>' +
      '<path class="pi-b" d="M12 4h8l-1 3h-6z"/>' +
      '<path class="pi-m" d="M10 8h12l1 4v14a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V12z"/>' +
      '<path class="pi-b" d="M20 8l2 4v14a2 2 0 0 1-2 2h-3V8z" opacity=".5"/>' +
      '<path class="pi-l" d="M9 14h14v7H9z" opacity=".9"/>' +
      '<path class="pi-a" d="M11 16h10v2H11z" opacity=".8"/>' +
      '<circle class="pi-l" cx="13" cy="9" r="1"/>' +
      '<circle class="pi-l" cx="9" cy="10" r=".7"/>' +
      '<circle class="pi-l" cx="11" cy="7" r=".5"/>' +
      '<path class="pi-s" d="M13 2h6M12 7h8M12 11h8M9 14v7M23 14v7M13 18h6"/>'
    ),
    hygiene: icon(
      '<ellipse class="pi-shadow" cx="16" cy="28" rx="10" ry="2"/>' +
      '<path class="pi-l" d="M6 13l10-5 10 5-10 5z"/>' +
      '<path class="pi-a" d="M6 13l10 5v10l-10-5z"/>' +
      '<path class="pi-b" d="M26 13l-10 5v10l10-5z"/>' +
      '<path class="pi-i" d="M10 12l6-3 6 3-6 3z" opacity=".9"/>' +
      '<path class="pi-l" d="M13 6c1.5-1 3-.5 4 .5s2 1 3 .5v4c-1.5.5-3 .5-4-.5s-2.5-1.5-3-.5z"/>' +
      '<path class="pi-m" d="M9 15l7 3v5l-7-3z" opacity=".85"/>' +
      '<path class="pi-s" d="M6 13l10 5 10-5M16 18v10M13 6c1.5-1 3-.5 4 .5s2 1 3 .5M9 15l7 3 7-3"/>'
    ),
    soap: icon(
      '<ellipse class="pi-shadow" cx="16" cy="26" rx="9" ry="2"/>' +
      '<path class="pi-l" d="M6 12l10-5 10 5-10 5z"/>' +
      '<path class="pi-a" d="M6 12l10 5v6l-10-5z"/>' +
      '<path class="pi-b" d="M26 12l-10 5v6l10-5z"/>' +
      '<path class="pi-i" d="M9 12l7-3.5 7 3.5-7 3.5z" opacity=".55"/>' +
      '<path class="pi-m" d="M11 13c1.5-.8 3-.8 4.5 0s3 .8 4.5 0" opacity=".8"/>' +
      '<circle class="pi-l" cx="8" cy="8" r="1.5"/>' +
      '<circle class="pi-l" cx="5" cy="11" r="1"/>' +
      '<circle class="pi-l" cx="10" cy="5" r=".8"/>' +
      '<path class="pi-s" d="M6 12l10 5 10-5M16 17v6M9 12l7 3.5 7-3.5M11 13c1.5-.8 3-.8 4.5 0s3 .8 4.5 0"/>'
    ),
    care: icon(
      '<ellipse class="pi-shadow" cx="16" cy="27" rx="9" ry="2"/>' +
      '<ellipse class="pi-l" cx="16" cy="9" rx="8" ry="3"/>' +
      '<path class="pi-a" d="M8 9v10c0 1.7 3.6 3 8 3s8-1.3 8-3V9c0 1.7-3.6 3-8 3S8 10.7 8 9z"/>' +
      '<path class="pi-b" d="M21 9.5v9.6c0 1.2-2.2 2.3-5 2.7V9.5c2.8 0 5-.2 5-.2z"/>' +
      '<path class="pi-i" d="M9 13h14v5H9z" opacity=".9"/>' +
      '<path class="pi-h" d="M12 15c1.5-1 3 1 4.5 0s2.5-.5 3.5 0" opacity=".8"/>' +
      '<path class="pi-c" d="M20 4l.7 1.4 1.4.7-1.4.7-.7 1.4-.7-1.4-1.4-.7 1.4-.7z"/>' +
      '<path class="pi-s" d="M8 9c0 1.7 3.6 3 8 3s8-1.3 8-3M8 12h16M9 18h14"/>'
    ),
    health: icon(
      '<ellipse class="pi-shadow" cx="16" cy="28" rx="7" ry="2"/>' +
      '<rect class="pi-b" x="12" y="2" width="8" height="3" rx="1"/>' +
      '<path class="pi-d" d="M12 4h8v2h-8z" opacity=".5"/>' +
      '<path class="pi-a" d="M11 7h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/>' +
      '<path class="pi-b" d="M19 7h2a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-4V7z"/>' +
      '<path class="pi-i" d="M10 13h12v8H10z" opacity=".95"/>' +
      '<path class="pi-f" d="M15 14h2v5h-2zM14 15h4v2h-4z"/>' +
      '<path class="pi-s" d="M14 5h4M13 12h6M13 21h6M10 13v8M22 13v8"/>'
    ),
    snack: icon(
      '<ellipse class="pi-shadow" cx="16" cy="29" rx="9" ry="2"/>' +
      '<path class="pi-a" d="M9 6h14l2 4-2 17H11L9 10z"/>' +
      '<path class="pi-b" d="M20 6h3l2 4-2 17h-3z"/>' +
      '<path class="pi-c" d="M11 7l2 2-2 2 2 2-2 2 2 2" opacity=".7"/>' +
      '<path class="pi-i" d="M11 13h10v7H11z" opacity=".9"/>' +
      '<path class="pi-c" d="M13 15c1-1.5 3-1.5 4 0-1 1.5-3 1.5-4 0z"/>' +
      '<path class="pi-o" d="M14 16.5l3-1.5 1 3-3 1.5z" opacity=".8"/>' +
      '<path class="pi-s" d="M9 10h14M11 24h10M13 6l1 4M19 6l-1 4M12 14h8M12 18h5"/>'
    ),
    noodles: icon(
      '<ellipse class="pi-shadow" cx="16" cy="29" rx="9" ry="2"/>' +
      '<path class="pi-a" d="M9 5h14l2 4-2 18H11L9 9z"/>' +
      '<path class="pi-b" d="M20 5h3l2 4-2 18h-3z"/>' +
      '<path class="pi-i" d="M11 11h10v10H11z" opacity=".92"/>' +
      '<path class="pi-c" d="M13 14c1.5-1.5 3 1.5 4.5 0s2.5 1 3.5 0M13 17c1.5-1.5 3 1.5 4.5 0s2.5 1 3.5 0M13 20c1.5-1.5 3 1.5 4.5 0" opacity=".9"/>' +
      '<path class="pi-s" d="M9 9h14M11 23h10M13 5l1 4M19 5l-1 4M11 11h10"/>'
    ),
    rice: icon(
      '<ellipse class="pi-shadow" cx="16" cy="29" rx="9" ry="2"/>' +
      '<path class="pi-d" d="M12 5l4-3 4 3z"/>' +
      '<path class="pi-a" d="M10 7c1-2 3-3 6-3s5 1 6 3l2 18a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z"/>' +
      '<path class="pi-b" d="M19 4c3 0 4 2 4 4l2 18a2 2 0 0 1-2 2h-5V4z"/>' +
      '<path class="pi-i" d="M9 14h14v7H9z" opacity=".9"/>' +
      '<path class="pi-c" d="M13 16c.5-.8 1.2-.8 1.7 0s1.2.8 1.7 0 1.2-.8 1.7 0" opacity=".9"/>' +
      '<path class="pi-l" d="M13 19c.5-.8 1.2-.8 1.7 0s1.2.8 1.7 0" opacity=".7"/>' +
      '<path class="pi-s" d="M11 9c2-1 8-1 10 0M12 5l4 2 4-2M9 14h14M9 21h14M12 17h8"/>'
    ),
    dairy: icon(
      '<ellipse class="pi-shadow" cx="16" cy="29" rx="8" ry="2"/>' +
      '<path class="pi-i" d="M10 9l6-6v7z"/>' +
      '<path class="pi-a" d="M16 3l6 6h-6z"/>' +
      '<path class="pi-a" d="M11 9h10v17a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2z"/>' +
      '<path class="pi-b" d="M19 9h2v17a2 2 0 0 1-2 2h-2V9z"/>' +
      '<path class="pi-i" d="M11 14h10v8H11z" opacity=".92"/>' +
      '<path class="pi-m" d="M14 16c1-1.5 3-1.5 4 0-1 1.5-3 1.5-4 0z" opacity=".9"/>' +
      '<path class="pi-s" d="M11 9h10M10 9l6-6 6 6M13 17h6M13 20h4M11 14v8M21 14v8"/>'
    ),
    bread: icon(
      '<ellipse class="pi-shadow" cx="16" cy="29" rx="10" ry="2"/>' +
      '<path class="pi-e" d="M7 14c0-4 4-7 9-7s9 3 9 7v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z"/>' +
      '<path class="pi-b" d="M19 7c4 .5 6 3 6 7v9a2 2 0 0 1-2 2h-4V7z" opacity=".35"/>' +
      '<path class="pi-i" d="M9 16h14v5H9z" opacity=".9"/>' +
      '<path class="pi-c" d="M11 17c1-.7 2-.7 3 0M16 17c1-.7 2-.7 3 0" opacity=".8"/>' +
      '<path class="pi-s" d="M11 11c1-1 3-2 5-2M12 14l2-2M16 14l2-2M20 14l2-2M9 16h14"/>'
    ),
    clean: icon(
      '<ellipse class="pi-shadow" cx="16" cy="29" rx="7" ry="2"/>' +
      '<path class="pi-d" d="M15 2h4v2h-4z"/>' +
      '<path class="pi-b" d="M19 3h7v2h-5v2h-2z"/>' +
      '<path class="pi-a" d="M11 8h10l2 5v14a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V13z"/>' +
      '<path class="pi-b" d="M19 8l2 5v14a2 2 0 0 1-2 2h-2V8z"/>' +
      '<path class="pi-i" d="M10 14h12v7H10z" opacity=".9"/>' +
      '<path class="pi-m" d="M12 16c1.5-1 3 1 4.5 0s2.5-.5 3.5 0" opacity=".85"/>' +
      '<path class="pi-c" d="M26 6l2-1M26 8h2M26 10l2 1"/>' +
      '<path class="pi-s" d="M13 5h4M12 12h8M13 17h6M10 14v7M22 14v7M26 6l2-1M26 8h2"/>'
    ),
    baby: icon(
      '<ellipse class="pi-shadow" cx="16" cy="29" rx="7" ry="2"/>' +
      '<path class="pi-h" d="M13 2c0-1 6-1 6 0v3h-6z"/>' +
      '<path class="pi-b" d="M12 5h8v3h-8z"/>' +
      '<path class="pi-a" d="M11 8h10l1 4v14a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V12z"/>' +
      '<path class="pi-b" d="M19 8h2l1 4v14a2 2 0 0 1-2 2h-1V8z"/>' +
      '<path class="pi-i" d="M10 14h12v8H10z" opacity=".92"/>' +
      '<path class="pi-h" d="M12 16h8v2h-8z" opacity=".6"/>' +
      '<path class="pi-s" d="M13 5h6M12 11h8M10 14v8M22 14v8M13 18h6M13 21h4M15 3h2"/>'
    ),
    coffee: icon(
      '<ellipse class="pi-shadow" cx="16" cy="27" rx="8" ry="2"/>' +
      '<path class="pi-a" d="M8 10h14v9a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5z"/>' +
      '<path class="pi-b" d="M22 12h2a4 4 0 0 1 0 8h-2v-3h2a1 1 0 0 0 0-2h-2z"/>' +
      '<ellipse class="pi-e" cx="15" cy="10" rx="7" ry="2.2"/>' +
      '<ellipse class="pi-l" cx="15" cy="10" rx="5" ry="1.4" opacity=".5"/>' +
      '<path class="pi-s" d="M8 10h14M11 7c1-2 2-2 2-4M16 7c1-2 2-2 2-4M8 24h14M13 18h4"/>'
    ),
    pet: icon(
      '<ellipse class="pi-shadow" cx="16" cy="29" rx="9" ry="2"/>' +
      '<path class="pi-a" d="M8 6h16l2 4-2 18H10L8 10z"/>' +
      '<path class="pi-b" d="M21 6h3l2 4-2 18h-3z"/>' +
      '<path class="pi-i" d="M11 12h10v9H11z" opacity=".9"/>' +
      '<ellipse class="pi-e" cx="16" cy="16" rx="2" ry="1.6"/>' +
      '<circle class="pi-e" cx="12.5" cy="13.5" r="1"/>' +
      '<circle class="pi-e" cx="16" cy="12.5" r="1"/>' +
      '<circle class="pi-e" cx="19.5" cy="13.5" r="1"/>' +
      '<path class="pi-s" d="M8 10h16M11 24h10M13 6l1 4M19 6l-1 4M11 12h10"/>'
    ),
    frozen: icon(
      '<ellipse class="pi-shadow" cx="16" cy="29" rx="9" ry="2"/>' +
      '<path class="pi-a" d="M8 6h16l2 4-2 18H10L8 10z"/>' +
      '<path class="pi-b" d="M21 6h3l2 4-2 18h-3z"/>' +
      '<path class="pi-i" d="M11 12h10v10H11z" opacity=".92"/>' +
      '<path class="pi-m" d="M16 13v8M12.5 15l7 4M19.5 15l-7 4M13.5 13.5l5 7M18.5 13.5l-5 7" opacity=".85"/>' +
      '<path class="pi-s" d="M8 10h16M11 24h10M13 6l1 4M19 6l-1 4M11 12h10"/>'
    ),
    condiment: icon(
      '<ellipse class="pi-shadow" cx="16" cy="28" rx="7" ry="2"/>' +
      '<path class="pi-d" d="M15 2h3l1 5h-5z"/>' +
      '<path class="pi-a" d="M11 8h10l2 5v13a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V13z"/>' +
      '<path class="pi-b" d="M19 8l2 5v13a2 2 0 0 1-2 2h-2V8z"/>' +
      '<path class="pi-i" d="M10 14h12v7H10z" opacity=".92"/>' +
      '<path class="pi-f" d="M13 16c1-1.5 3-1.5 4 0-1 1.5-3 1.5-4 0z"/>' +
      '<path class="pi-s" d="M13 10h6M12 13h8M13 18h6M13 21h4M10 14v7M22 14v7"/>'
    ),
    toothpaste: icon(
      '<ellipse class="pi-shadow" cx="16" cy="28" rx="8" ry="2"/>' +
      '<path class="pi-d" d="M21 4h4v4h-4z"/>' +
      '<path class="pi-i" d="M9 7h12l2 4v14l-2 2H9l-2-2V11z"/>' +
      '<path class="pi-a" d="M9 7h12l2 4v3H7v-3z"/>' +
      '<path class="pi-b" d="M21 7l2 4v14l-2 2h-2V7z" opacity=".35"/>' +
      '<path class="pi-m" d="M8 15c3-2 6 2 9 0s5 0 6 0v3c-1 0-3-2-6 0s-6-2-9 0z" opacity=".85"/>' +
      '<path class="pi-s" d="M9 7h12M7 11h16M8 14h15M9 21h12M21 4h4"/>'
    ),
    sanitary: icon(
      '<ellipse class="pi-shadow" cx="16" cy="28" rx="8" ry="2"/>' +
      '<path class="pi-h" d="M9 6h14l2 4-2 17H11L9 10z"/>' +
      '<path class="pi-b" d="M21 6h2l2 4-2 17h-2z" opacity=".35"/>' +
      '<path class="pi-i" d="M11 12h10v8H11z" opacity=".92"/>' +
      '<path class="pi-h" d="M13 14c0-1 1-2 3-2s3 1 3 2v4c0 1-1 2-3 2s-3-1-3-2z" opacity=".8"/>' +
      '<circle class="pi-c" cx="18" cy="9" r=".8"/>' +
      '<path class="pi-s" d="M9 10h14M11 24h10M13 6l1 4M19 6l-1 4M11 12h10M16 12v8"/>'
    ),
    sanitizer: icon(
      '<ellipse class="pi-shadow" cx="16" cy="29" rx="7" ry="2"/>' +
      '<path class="pi-b" d="M18 2h5v2h-3v2h-2z"/>' +
      '<path class="pi-d" d="M14 5h5v2h-5z"/>' +
      '<path class="pi-i" d="M11 8h10l2 5v13a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V13z"/>' +
      '<path class="pi-n" d="M19 8l2 5v13a2 2 0 0 1-2 2h-2V8z" opacity=".55"/>' +
      '<path class="pi-m" d="M10 14h12v8H10z"/>' +
      '<path class="pi-l" d="M14 16c1-1.5 3-1.5 4 0-1 1.5-3 1.5-4 0z" opacity=".9"/>' +
      '<path class="pi-s" d="M15 5h4M12 11h8M10 14v8M22 14v8M13 18h6"/>'
    ),
    box: icon(
      '<ellipse class="pi-shadow" cx="16" cy="29" rx="10" ry="2"/>' +
      '<path class="pi-l" d="M16 3l11 6-11 6-11-6z"/>' +
      '<path class="pi-a" d="M5 9l11 6v14L5 23z"/>' +
      '<path class="pi-b" d="M27 9l-11 6v14l11-6z"/>' +
      '<path class="pi-i" d="M8 13l6 3v5l-6-3z" opacity=".9"/>' +
      '<path class="pi-c" d="M14 6l2 1v6l-2-1z" opacity=".85"/>' +
      '<path class="pi-s" d="M5 9l11 6 11-6M16 15v14M8 13l6 3 6-3M14 6l2 1 2-1"/>'
    )
  };

  function normalize(value) {
    return String(value == null ? '' : value).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Specific product and brand rules win over broad category rules, so Calla,
  // Cetaphil, baby cologne, acne powder, wipes, and drinks stay distinct.
  function kind(category, name) {
    var n = normalize(name);
    var c = normalize(category);
    var text = n + ' ' + c;

    if (/baby cologne|baby bench|colonia|kolonya/.test(n)) return 'cologne';
    if (/\bcologne\b|perfume|fragrance/.test(n)) return 'cologne';
    if (/antibacterial wipes?|wet wipes?|\bwipes?\b|wet tissue|cleansing wipes?/.test(n)) return 'wipes';
    if (/\bacne\b|pimple|blemish|medicated powder/.test(n)) return 'acne';
    if (/\bcalla\b|laundry|detergent|fabcon|fabric (conditioner|softener)|bleach|downy|comfort/.test(n)) return 'detergent';
    if (/\bcetaphil\b/.test(n)) return 'skincare';
    if (/shampoo|conditioner|keratin|head ?& ?shoulder|head and shoulder|hair (treatment|mask|serum)|hot oil/.test(n)) return 'shampoo';
    if (/(dish ?wash|dish ?soap|floor wax|cleaner|cleaning|air freshener|trash bag|garbage bag|household)/.test(n)) return 'clean';
    if (/\bsoap\b|bath soap|bar soap|beauty soap|geisha|safeguard|palmolive|irish spring|lifebuoy/.test(n)) return 'soap';
    if (/toothpaste|toothbrush|oral care|colgate|close ?up/.test(n)) return 'toothpaste';
    if (/sanitary|pantyliner|panty liner|napkin|menstrual|\bsister\b/.test(n)) return 'sanitary';
    if (/alcohol|sanitizer|antiseptic|disinfect/.test(n)) return 'sanitizer';
    if (/\btissue\b|diaper|deodorant/.test(n)) return 'hygiene';
    if (/(skin ?care|skincare|facial|moistur|serum|sunscreen|toner|cleanser|retinol|collagen|lotion|beauty|cosmetic|dazzle|makeup)/.test(text)) return 'care';
    if (/(deodorant|diaper|tissue|hygiene|personal care)/.test(n)) return 'hygiene';
    if (/(medicine|tablet|capsule|vitamin|paracetamol|biogesic|alaxan|neozep|syrup|ointment|bandage|first aid|health)/.test(n)) return 'health';
    if (/soft ?drink|soda|\bcola\b|\bcoke\b|\bsprite\b|\bpepsi\b|\broyal\b|mountain dew|7up|mirinda|sarsi|energy drink|sports drink|carbonated/.test(n)) return 'can';
    if (/bottled water|mineral water|purified water|drinking water|\bwater\b|water bottle|wilkins|absolute|nature'?s spring|summit|aquafina/.test(n)) return 'bottle';
    if (/chocolate.*(drink|milk|beverage)|milk tea|juice|beverage|\bdrink\b/.test(n)) return 'bottle';
    if (/coffee|\btea\b|nescafe|kopiko|great taste|3-in-1|3 in 1/.test(n)) return 'coffee';
    if (/chocolate|choco|cacao|candy|sweet/.test(n)) return 'chocolate';
    if (/canned|sardine|tuna|corned beef|luncheon meat|meat ?loaf|vienna sausage|tomato sauce|\bsauce\b|century tuna|555|ligo|argentina/.test(n)) return 'tin';
    if (/snack|chips?|crisps?|biscuit|cookie|wafer|cracker|nuts|popcorn|pretzel|gum|marie|rebisco|fita|skyflakes/.test(n)) return 'snack';
    if (/\brice\b|\bgrain/.test(n)) return 'rice';
    if (/noodle|ramen|pancit|mami|pasta|spaghetti|macaroni|bihon|canton/.test(n)) return 'noodles';
    if (/milk|cheese|butter|margarine|yogurt|yoghurt|cream|dairy|\begg\b/.test(n)) return 'dairy';
    if (/bread|loaf|pandesal|cake|pastry|\bbun\b|ensaymada|hopia|croissant|muffin|donut|doughnut|bakery/.test(n)) return 'bread';
    if (/\bbaby\b|infant/.test(n)) return 'baby';
    if (/\bpet\b|animal|dog food|cat food/.test(n)) return 'pet';
    if (/frozen|chilled/.test(n)) return 'frozen';
    if (/condiment|sauce|spice|seasoning|vinegar|soy/.test(n)) return 'condiment';

    if (/coffee|tea/.test(c)) return 'coffee';
    if (/beverage|drink|juice|water/.test(c)) return 'bottle';
    if (/canned|canning/.test(c)) return 'tin';
    if (/chocolate|choco/.test(c)) return 'chocolate';
    if (/\brice\b|grain/.test(c)) return 'rice';
    if (/snack|chips|candy|confection/.test(c)) return 'snack';
    if (/noodle|pasta/.test(c)) return 'noodles';
    if (/dairy|milk|cheese|egg/.test(c)) return 'dairy';
    if (/bakery|bread|pastry|cake/.test(c)) return 'bread';
    if (/hygiene|toiletr|personal care/.test(c)) return 'hygiene';
    if (/medicine|health|pharmacy|first aid/.test(c)) return 'health';
    if (/skin ?care|beauty|cosmetic/.test(c)) return 'care';
    if (/laundry|detergent/.test(c)) return 'detergent';
    if (/household|cleaning|cleaner/.test(c)) return 'clean';
    if (/pantry|packed food|grocery/.test(c)) return 'snack';
    if (/baby|infant|kid/.test(c)) return 'baby';
    if (/pet|animal/.test(c)) return 'pet';
    if (/frozen|chilled/.test(c)) return 'frozen';
    if (/condiment|sauce|spice|seasoning/.test(c)) return 'condiment';
    return 'box';
  }

  function svg(iconKind) {
    return ICONS[iconKind] || ICONS.box;
  }

  function html(category, name, opts) {
    var iconKind = kind(category, name);
    var small = !!(opts && opts.small);
    return '<span class="pi' + (small ? ' sm' : '') + '" data-icon="' + iconKind + '" aria-hidden="true">' +
      svg(iconKind) + '</span>';
  }

  return { kind: kind, svg: svg, html: html, icons: ICONS };
});
