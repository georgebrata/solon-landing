(function () {
  "use strict";

  const year = String(new Date().getFullYear());
  const nodes = document.querySelectorAll("[data-current-year]");

  nodes.forEach(function (node) {
    node.textContent = year;
  });
})();
