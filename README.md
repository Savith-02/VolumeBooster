# VolumeBooster Chrome Extension

A powerful Chrome extension that allows you to boost the volume of any audio or video content beyond your browser's default maximum volume.

## Features

- 🔊 Boost volume up to 5x the original level
- 💫 Dynamic audio detection (works with dynamically loaded content)
- 🎯 Floating UI control panel
- 🎛️ Quick preset volume controls (1.5x, 2x, 3x, 5x)
- 🔄 Seamless audio transition when enabling/disabling
- 🎮 Draggable control panel
- 🌐 Works with Shadow DOM elements
- ⚡ Support for both HTML5 audio and video elements

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the VolumeBooster directory

## Usage

1. After installation, you'll see the VolumeBooster icon in your Chrome toolbar
2. Click the icon to enable/disable the volume booster
3. Toggle the floating UI panel for easy access to volume controls
4. Use the slider or preset buttons to adjust the volume multiplier
5. The status indicator shows whether the booster is active or inactive

## Controls

- **Slider**: Adjust volume from 1x to 5x
- **Preset Buttons**: Quickly set volume to common multipliers
- **Floating UI**:
  - Drag the header to reposition the panel
  - Click the × to close the panel
  - Shows real-time status and current volume level

## Technical Details

The extension uses the Web Audio API to process and boost audio signals. It:

- Automatically detects and connects to audio/video elements
- Monitors DOM changes for newly added media elements
- Preserves audio quality while boosting volume
- Handles audio source changes seamlessly
- Works with both regular and Shadow DOM content

## Troubleshooting

If you encounter any issues:

- Check if the extension is enabled in Chrome
- Refresh the page if audio elements were present before enabling the booster
- Look for error notifications in the floating UI or bottom-right corner
- Make sure your system's audio output is working correctly

## Notes

- The maximum boost level is capped at 5x for audio quality reasons
- Some websites may use custom audio implementations that aren't compatible
- The extension preserves your settings between browser sessions

## Privacy

This extension:

- Does not collect any user data
- Does not modify any website content except for audio volume
- Works entirely locally in your browser
- Requires only necessary permissions for audio processing
