(function () {
  "use strict";

  var year = String(new Date().getFullYear());
  var nodes = document.querySelectorAll("[data-current-year]");

  nodes.forEach(function (node) {
    node.textContent = year;
  });
})();
