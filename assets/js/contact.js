document.addEventListener('DOMContentLoaded', function() {
    try {
        // Find the element with the id 'contact'
        var contactElement = document.getElementById('contact');
        
        // Check if the contact element exists
        if (!contactElement) {
            throw new Error("Element with id 'contact' not found.");
        }

        // Create a new iframe element
        var iframe = document.createElement('iframe');

        // Set the src attribute of the iframe
        iframe.src = 'https://us21.list-manage.com/contact-form?u=8cfcf6d7f1f80308125058838&form_id=83c3568e3e4044a508584b292af3395d';

        // Set additional attributes for better control over the iframe's behavior
        iframe.width = '100%'; // Make the iframe take the full width of its parent
        iframe.height = '890px'; // Set a fixed height for the iframe
        iframe.style.border = 'none'; // Remove the default border

        // Append the iframe to the contact element
        contactElement.appendChild(iframe);
    } catch (error) {
        // Log the error to the console
        console.error("An error occurred:", error.message);
    }
});
