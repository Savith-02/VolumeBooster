document.addEventListener("DOMContentLoaded", function () {
  const enableBoosterCheckbox = document.getElementById("enableBooster");
  const showFloatingUIButton = document.getElementById("showFloatingUI");
  const statusElement = document.createElement("div");
  statusElement.className = "status";
  document.body.appendChild(statusElement);

  // Initialize checkbox state from storage
  chrome.storage.local.get(
    ["boosterEnabled", "floatingUIVisible"],
    function (result) {
      enableBoosterCheckbox.checked = result.boosterEnabled || false;

      // Send message to content script when checkbox changes
      enableBoosterCheckbox.addEventListener("change", function () {
        const enabled = enableBoosterCheckbox.checked;
        chrome.storage.local.set({ boosterEnabled: enabled });
        sendMessageToActiveTab({
          action: "toggleBooster",
          enabled: enabled,
        });
      });

      // Toggle floating UI visibility
      showFloatingUIButton.addEventListener("click", function () {
        sendMessageToActiveTab({
          action: "toggleFloatingUI",
        });
      });
    }
  );

  // Safer way to send messages to the active tab
  function sendMessageToActiveTab(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs.length === 0) {
        showStatus("No active tab found", true);
        return;
      }

      try {
        chrome.tabs.sendMessage(tabs[0].id, message, function (response) {
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message;
            console.log("Error sending message:", errorMsg);
            showStatus(errorMsg, true);

            // If content script isn't ready, try to inject it
            if (errorMsg.includes("Receiving end does not exist")) {
              // Check if we can inject scripts on this page
              if (tabs[0].url.startsWith("http")) {
                // showStatus("Injecting script...");
                console.log("Injecting script...");
                chrome.scripting
                  .executeScript({
                    target: { tabId: tabs[0].id },
                    files: ["content.js"],
                  })
                  .then(() => {
                    // Try sending the message again after injection
                    setTimeout(() => {
                      chrome.tabs.sendMessage(
                        tabs[0].id,
                        message,
                        (secondResponse) => {
                          if (chrome.runtime.lastError) {
                            showStatus(
                              "Failed to initialize on this page",
                              true
                            );
                          } else {
                            // showStatus("Extension activated");
                            console.log("Extension activated");
                          }
                        }
                      );
                    }, 200);
                  })
                  .catch((err) => {
                    showStatus(
                      "Can't inject on this page: " + err.message,
                      true
                    );
                  });
              } else {
                showStatus("Can't run on this page type", true);
              }
            }
          } else if (response && response.success) {
            // showStatus("Command sent successfully");
            console.log("Command sent successfully");
          }
        });
      } catch (e) {
        console.log("Error in sendMessage:", e);
        showStatus("Error: " + e.message, true);
      }
    });
  }

  // Show status message in popup
  function showStatus(message, isError = false) {
    statusElement.textContent = message;
    statusElement.style.cssText = `
      margin-top: 10px;
      padding: 5px;
      font-size: 12px;
      border-radius: 4px;
      text-align: center;
      background-color: ${isError ? "#ffebee" : "#e8f5e9"};
      color: ${isError ? "#c62828" : "#2e7d32"};
    `;

    // Clear status after 3 seconds
    setTimeout(() => {
      statusElement.textContent = "";
      statusElement.style.cssText = "";
    }, 3000);
  }
});
