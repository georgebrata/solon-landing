const container = document.querySelector('.fireworks')
const fireworks = new Fireworks.default(container)
fireworks.start()
function scrollToElement(elementId, seconds) {
    // Wait for 5 seconds
    setTimeout(function () {
        // Get the target element
        var targetElement = document.getElementById(elementId);

        // Check if the element exists
        if (targetElement) {
            // Scroll to the element
            targetElement.scrollIntoView({
                behavior: 'smooth', // You can change this to 'auto' for instant scrolling
                block: 'start',
                block: 'center'
            });
        } else {
            console.error("Element with id '" + elementId + "' not found.");
        }
    }, seconds * 1000); // 5000 milliseconds = 5 seconds
}

scrollToElement("scroll", 3)