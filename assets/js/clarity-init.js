(function () {
  "use strict";

  const PROJECT_ID = "w9hin0o1ua";
  window.clarity =
    window.clarity ||
    function clarityStub() {
      (window.clarity.q = window.clarity.q || []).push(arguments); // skipcq: JS-W1023
    };
  const tag = document.createElement("script");
  tag.async = true;
  tag.src = `https://www.clarity.ms/tag/${PROJECT_ID}`;
  const first = document.getElementsByTagName("script")[0];
  if (first && first.parentNode) {
    first.parentNode.insertBefore(tag, first);
  } else {
    document.head.appendChild(tag);
  }
})();
