// content.js - Updated to prevent audio disruption when disabled
(function () {
  let audioContext = null;
  let gainNode = null;
  let mediaElements = [];
  let audioSources = [];
  let boosterEnabled = false;
  let floatingUIVisible = false;
  let floatingUI = null;
  let currentGain = 2.0; // Default gain value (2x)
  let errorNotificationTimeout = null;

  // Initialize from storage
  chrome.storage.local.get(
    ["boosterEnabled", "floatingUIVisible", "gainValue"],
    function (result) {
      boosterEnabled = result.boosterEnabled || false;
      floatingUIVisible = result.floatingUIVisible || false;
      currentGain = result.gainValue || 2.0;

      if (floatingUIVisible) {
        createFloatingUI();
      }

      try {
        setupAudioContext();
        processExistingAudio();
        setupAudioObserver();

        // Apply appropriate gain based on status
        if (gainNode) {
          gainNode.gain.value = boosterEnabled ? currentGain : 1.0;
        }

        // Re-scan for audio elements periodically to catch dynamically added elements
        setInterval(() => {
          processExistingAudio();
        }, 5000);
      } catch (e) {
        showError("Failed to initialize audio booster: " + e.message);
        console.error("Volume Booster initialization error:", e);
      }
    }
  );

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener(function (
    request,
    sender,
    sendResponse
  ) {
    if (request.action === "toggleBooster") {
      boosterEnabled = request.enabled;
      chrome.storage.local.set({ boosterEnabled: boosterEnabled });

      try {
        // Instead of disconnecting, just set gain to 1.0 when disabled
        if (!audioContext) {
          setupAudioContext();
        }

        if (gainNode) {
          gainNode.gain.value = boosterEnabled ? currentGain : 1.0;
        }

        processExistingAudio();
        setupAudioObserver();
        updateStatus();
      } catch (e) {
        showError(
          boosterEnabled
            ? "Failed to enable audio booster: " + e.message
            : "Failed to disable audio booster: " + e.message
        );
        console.error("Volume Booster toggle error:", e);
      }

      sendResponse({ success: true });
    } else if (request.action === "toggleFloatingUI") {
      floatingUIVisible = !floatingUIVisible;
      chrome.storage.local.set({ floatingUIVisible: floatingUIVisible });

      if (floatingUIVisible) {
        createFloatingUI();
      } else if (floatingUI) {
        document.body.removeChild(floatingUI);
        floatingUI = null;
      }
      sendResponse({ success: true });
    } else if (request.action === "updateGain") {
      currentGain = request.value;
      chrome.storage.local.set({ gainValue: currentGain });

      // Only apply new gain if booster is enabled
      if (boosterEnabled && gainNode) {
        gainNode.gain.value = currentGain;
      }

      sendResponse({ success: true });
    }
    return true; // Keep the message channel open for async response
  });

  function updateStatus() {
    if (!floatingUI) return;

    const statusText = floatingUI.querySelector(".volume-booster-status-text");
    if (statusText) {
      statusText.textContent = `Status: ${
        boosterEnabled ? "Active" : "Inactive"
      }`;
      statusText.style.backgroundColor = boosterEnabled ? "#e6f4ea" : "#f8f9fa";
      statusText.style.color = boosterEnabled ? "#137333" : "#666";
      statusText.style.border = `1px solid ${
        boosterEnabled ? "#ceead6" : "#dadce0"
      }`;
    }
  }

  // Create and set up Web Audio API context
  function setupAudioContext() {
    if (!audioContext) {
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        gainNode = audioContext.createGain();
        // Set gain based on whether booster is enabled
        gainNode.gain.value = boosterEnabled ? currentGain : 1.0;
        gainNode.connect(audioContext.destination);
      } catch (e) {
        console.error("Failed to create audio context:", e);
        throw e;
      }
    }
  }

  // Process all existing audio elements on the page
  function processExistingAudio() {
    try {
      const audioTags = document.querySelectorAll("audio, video");
      audioTags.forEach(connectAudioElement);

      // Search for audio elements inside Shadow DOM
      findAudioInShadows(document.body);
    } catch (e) {
      console.error("Error processing existing audio:", e);
      showError("Error finding audio elements: " + e.message);
    }
  }

  // Find audio elements in Shadow DOM
  function findAudioInShadows(node) {
    if (!node) return;

    if (node.shadowRoot) {
      try {
        const shadowAudio = node.shadowRoot.querySelectorAll("audio, video");
        shadowAudio.forEach(connectAudioElement);

        // Recursively check child nodes in shadow root
        node.shadowRoot.querySelectorAll("*").forEach(findAudioInShadows);
      } catch (e) {
        console.error("Shadow DOM access error:", e);
      }
    }

    // Check child nodes
    if (node.children) {
      Array.from(node.children).forEach(findAudioInShadows);
    }
  }

  // Connect audio element to our audio context
  function connectAudioElement(element) {
    if (!element || mediaElements.includes(element)) return;

    try {
      // Check if element is valid
      if (!(element instanceof HTMLMediaElement)) {
        return;
      }

      const source = audioContext.createMediaElementSource(element);
      source.connect(gainNode);
      mediaElements.push(element);
      audioSources.push(source);

      // Add event listener for source changes
      element.addEventListener("srcchange", () => {
        try {
          // Reconnect when source changes
          connectAudioElement(element);
        } catch (e) {
          console.error("Source change reconnection error:", e);
        }
      });
    } catch (e) {
      console.error("Error connecting audio element:", e);
      // Only show UI error for non-duplicate element errors
      if (!e.message.includes("already connected")) {
        showError("Failed to boost audio: " + e.message);
      }
    }
  }

  // Update gain value for all connected audio
  function updateGain() {
    if (gainNode) {
      try {
        // Only apply boost if enabled, otherwise set to neutral 1.0
        gainNode.gain.value = boosterEnabled ? currentGain : 1.0;
      } catch (e) {
        console.error("Error updating gain:", e);
        showError("Failed to update volume: " + e.message);
      }
    }
  }

  // Observe DOM for newly added audio/video elements
  function setupAudioObserver() {
    try {
      const observer = new MutationObserver(function (mutations) {
        let newAudioFound = false;

        mutations.forEach(function (mutation) {
          if (mutation.addedNodes) {
            mutation.addedNodes.forEach(function (node) {
              if (node.tagName === "AUDIO" || node.tagName === "VIDEO") {
                connectAudioElement(node);
                newAudioFound = true;
              } else if (node.querySelectorAll) {
                try {
                  const audioTags = node.querySelectorAll("audio, video");
                  if (audioTags.length > 0) {
                    audioTags.forEach(connectAudioElement);
                    newAudioFound = true;
                  }

                  // Check for Shadow DOM in new nodes
                  if (node.nodeType === Node.ELEMENT_NODE) {
                    findAudioInShadows(node);
                  }
                } catch (e) {
                  console.error("Error processing mutation:", e);
                }
              }
            });
          }
        });
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    } catch (e) {
      console.error("Error setting up observer:", e);
      showError("Failed to monitor for new audio: " + e.message);
    }
  }

  // Show error notification in UI
  function showError(message) {
    if (!floatingUI) {
      // Create temporary notification if floating UI is not visible
      const notification = document.createElement("div");
      notification.className = "volume-booster-notification";
      notification.textContent = "Volume Booster: " + message;
      notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background-color: rgba(200, 0, 0, 0.9);
        color: white;
        padding: 10px 15px;
        border-radius: 5px;
        z-index: 10000000;
        font-family: Arial, sans-serif;
        font-size: 14px;
        max-width: 300px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
      `;

      document.body.appendChild(notification);

      // Remove notification after 5 seconds
      setTimeout(() => {
        if (document.body.contains(notification)) {
          document.body.removeChild(notification);
        }
      }, 5000);
    } else {
      // Show error in floating UI
      const errorElement = floatingUI.querySelector(".volume-booster-error");
      if (!errorElement) {
        const errorDiv = document.createElement("div");
        errorDiv.className = "volume-booster-error";
        errorDiv.style.cssText = `
          background-color: rgba(200, 0, 0, 0.8);
          color: white;
          padding: 5px 10px;
          margin-top: 8px;
          border-radius: 4px;
          font-size: 12px;
          text-align: center;
        `;
        errorDiv.textContent = message;
        floatingUI
          .querySelector(".volume-booster-content")
          .appendChild(errorDiv);

        // Clear previous timeout
        if (errorNotificationTimeout) {
          clearTimeout(errorNotificationTimeout);
        }

        // Remove error after 5 seconds
        errorNotificationTimeout = setTimeout(() => {
          if (errorElement && errorElement.parentNode) {
            errorElement.parentNode.removeChild(errorElement);
          }
        }, 5000);
      } else {
        errorElement.textContent = message;

        // Reset timeout
        if (errorNotificationTimeout) {
          clearTimeout(errorNotificationTimeout);
        }

        errorNotificationTimeout = setTimeout(() => {
          if (errorElement && errorElement.parentNode) {
            errorElement.parentNode.removeChild(errorElement);
          }
        }, 5000);
      }
    }
  }

  // Create floating UI control
  function createFloatingUI() {
    if (floatingUI) return;

    try {
      floatingUI = document.createElement("div");
      floatingUI.className = "volume-booster-floating-ui";
      floatingUI.innerHTML = `
        <div class="volume-booster-header">
          <span>Volume Booster</span>
          <button class="volume-booster-close">×</button>
        </div>
        <div class="volume-booster-content">
          <div class="volume-booster-slider-container">
            <input type="range" min="1" max="5" step="0.1" value="${currentGain}" class="volume-booster-slider">
            <span class="volume-booster-value">${currentGain}x</span>
          </div>
          <div class="volume-booster-buttons">
            <button class="volume-booster-preset" data-value="1.5">1.5x</button>
            <button class="volume-booster-preset" data-value="2">2x</button>
            <button class="volume-booster-preset" data-value="3">3x</button>
            <button class="volume-booster-preset" data-value="5">5x</button>
          </div>
          <div class="volume-booster-status">
            <span class="volume-booster-status-text">Status: ${
              boosterEnabled ? "Active" : "Inactive"
            }</span>
          </div>
        </div>
      `;

      // Add styling
      const style = document.createElement("style");
      style.textContent = `
        .volume-booster-floating-ui {
          position: fixed;
          top: 20px;
          right: 20px;
          width: 200px;
          background-color: #fff;
          border: 1px solid #ccc;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
          z-index: 9999999;
          font-family: Arial, sans-serif;
          user-select: none;
        }
        .volume-booster-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          background-color: #4285f4;
          color: white;
          border-top-left-radius: 8px;
          border-top-right-radius: 8px;
          cursor: move;
        }
        .volume-booster-close {
          background: none;
          border: none;
          color: white;
          font-size: 18px;
          cursor: pointer;
        }
        .volume-booster-content {
          padding: 12px;
        }
        .volume-booster-slider-container {
          display: flex;
          align-items: center;
          margin-bottom: 10px;
        }
        .volume-booster-slider {
          flex: 1;
          margin-right: 10px;
        }
        .volume-booster-value {
          font-weight: bold;
          min-width: 35px;
          color: #4285f4;
        }
        .volume-booster-buttons {
          display: flex;
          justify-content: space-between;
          margin-bottom: 10px;
        }
        .volume-booster-preset {
          background-color: #4285f4;
          border: 1px solid #ddd;
          border-radius: 4px;
          padding: 4px 8px;
          cursor: pointer;
          color: white;
        }
        .volume-booster-preset:hover {
          background-color:rgb(38, 120, 252);
        }
        .volume-booster-status {
          font-size: 12px;
          color: #666;
          text-align: center;
          margin-top: 5px;
        }
        .volume-booster-status-text {
          display: inline-block;
          padding: 3px 6px;
          border-radius: 3px;
          background-color: ${boosterEnabled ? "#e6f4ea" : "#f8f9fa"};
          color: ${boosterEnabled ? "#137333" : "#666"};
          border: 1px solid ${boosterEnabled ? "#ceead6" : "#dadce0"};
        }
        .volume-booster-error {
          background-color: rgba(200, 0, 0, 0.8);
          color: white;
          padding: 5px 10px;
          margin-top: 8px;
          border-radius: 4px;
          font-size: 12px;
          text-align: center;
        }
      `;
      document.head.appendChild(style);
      document.body.appendChild(floatingUI);

      // Make UI draggable
      let isDragging = false;
      let offsetX, offsetY;

      const header = floatingUI.querySelector(".volume-booster-header");
      header.addEventListener("mousedown", function (e) {
        isDragging = true;
        offsetX = e.clientX - floatingUI.getBoundingClientRect().left;
        offsetY = e.clientY - floatingUI.getBoundingClientRect().top;
      });

      document.addEventListener("mousemove", function (e) {
        if (!isDragging) return;

        floatingUI.style.left = e.clientX - offsetX + "px";
        floatingUI.style.top = e.clientY - offsetY + "px";
        floatingUI.style.right = "auto";
      });

      document.addEventListener("mouseup", function () {
        isDragging = false;
      });

      // Handle close button
      const closeButton = floatingUI.querySelector(".volume-booster-close");
      closeButton.addEventListener("click", function () {
        floatingUIVisible = false;
        chrome.storage.local.set({ floatingUIVisible: false });
        document.body.removeChild(floatingUI);
        floatingUI = null;
      });

      // Handle slider
      const slider = floatingUI.querySelector(".volume-booster-slider");
      const valueDisplay = floatingUI.querySelector(".volume-booster-value");

      slider.addEventListener("input", function () {
        currentGain = parseFloat(slider.value);
        valueDisplay.textContent = currentGain.toFixed(1) + "x";
        // Only update gain if booster is enabled
        if (boosterEnabled) {
          updateGain();
        }
        chrome.storage.local.set({ gainValue: currentGain });
      });

      // Handle preset buttons
      const presetButtons = floatingUI.querySelectorAll(
        ".volume-booster-preset"
      );
      presetButtons.forEach((button) => {
        button.addEventListener("click", function () {
          currentGain = parseFloat(button.dataset.value);
          slider.value = currentGain;
          valueDisplay.textContent = currentGain.toFixed(1) + "x";
          // Only update gain if booster is enabled
          if (boosterEnabled) {
            updateGain();
          }
          chrome.storage.local.set({ gainValue: currentGain });
        });
      });
    } catch (e) {
      console.error("Error creating floating UI:", e);
    }
  }
})();
