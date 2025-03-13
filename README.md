# VolumeBooster Chrome Extension

A powerful Chrome extension that allows you to boost the volume of any audio or video content beyond your browser's default maximum volume, while maintaining sound quality.

## Features

- 🔊 Boost volume up to 7x the original level
- 🎚️ Advanced sound quality controls to prevent distortion
- 🔍 Clarity enhancement for better audio balance
- 🛡️ Anti-distortion protection at high volumes
- 🎭 Content-specific presets for music, voice, and movies
- 💫 Dynamic audio detection (works with dynamically loaded content)
- 🎯 Intuitive floating UI control panel
- 🎛️ Quick preset volume controls (Slight, Medium, Loud, Maximum)
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
2. Click the icon to open the popup
3. Toggle the booster on/off using the switch
4. Use the slider or preset buttons to adjust the volume level
5. Click "Show/Hide Floating UI" for easy access to all controls
6. For advanced sound quality settings, open the "Sound Quality Enhancer" section
7. Choose content-specific presets for optimal sound (Music, Voice, Movie)

## Controls

- **Loudness Slider**: Adjust volume from 1x to 7x
- **Quick Volume Presets**: Quickly set volume to Slight (1.5x), Medium (3x), Loud (5x), or Maximum (7x)
- **Toggle Switch**: Turn the booster on/off with a single click
- **Sound Quality Enhancer**:
  - **Clarity Enhancer**: Makes quiet parts more audible without distorting loud parts
  - **Anti-Distortion Shield**: Prevents crackling and harshness at high volumes
  - **Content Presets**: Optimized settings for Music, Voice, and Movies
- **Floating UI**:
  - Drag the header to reposition the panel
  - Click the × to close the panel
  - Shows real-time status and current volume level

## Tips for Best Sound Quality

- For extremely high volume levels (6-7x), use the "Extreme Boost" preset
- Adjust the Clarity Level to make quiet sounds more audible
- Increase Protection Strength if you hear distortion at high volumes
- Different content types benefit from different settings:
  - Music works best with moderate clarity and light protection
  - Voice content benefits from high clarity and medium protection
  - Movies sound best with balanced settings

## Technical Details

The extension uses the Web Audio API to process and boost audio signals. It:

- Uses a sophisticated audio processing chain with gain, compression, and limiting
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
- If you hear distortion at high volumes, increase the Protection Strength
- For very quiet content, increase the Clarity Level

## Permissions

This extension requires the following permissions:

- **activeTab**: Needed to access and modify audio elements on the current page
- **scripting**: Required to inject the volume booster script into web pages
- **storage**: Used to save your preferences between browser sessions, including:
  - Volume level settings (up to 7x)
  - Booster on/off status
  - Floating UI visibility
  - Sound quality settings (clarity enhancement and distortion protection)

## Privacy

This extension:

- Does not collect any user data
- Does not modify any website content except for audio processing
- Works entirely locally in your browser
- Requires only necessary permissions for audio processing

## How It Works

The extension uses three main audio processing components:

1. **Gain Node**: Boosts the overall volume of the audio
2. **Clarity Enhancer** (Compressor): Balances loud and quiet sounds to prevent distortion
3. **Anti-Distortion Shield** (Limiter): Ensures the signal doesn't exceed maximum amplitude

This combination allows for much higher volume levels while maintaining audio quality.
