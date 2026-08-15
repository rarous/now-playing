# now-playing

WebAudio based server for recognizing now plaing music in audio stream.

## Armbian setting

This server is intended to run on Raspberry Pi 3B+ with Armbian distribution.

WebAudio need audio backend installed on the machine:

```shell
sudo apt install -y pipewire pipewire-alsa pipewire-jack pipewire-audio pipewire-pulse pipewire-audio-client-libraries libspa-0.2-jack wireplumber
sudo reboot
sudo cp /usr/share/doc/pipewire/examples/ld.so.conf.d/pipewire-jack-aarch64-linux-gnu.conf /etc/ld.so.conf.d/
sudo mv /etc/ld.so.conf.d/pipewire-jack-aarch64-linux-gnu.conf /etc/ld.so.conf.d/0-pipewire-jack-aarch64-linux-gnu.confsudo mv /etc/le --now pipewire.socket pipewire.service pipewire-pulse.socket pipewire-pulse.service wireplumber.service
```

Pipewire needs to be properly configured.
https://docs.pipewire.org/page_man_pipewire-jack_conf_5.html
https://mathieu-requillart.medium.com/my-ultimate-guide-to-the-raspberry-pi-audio-server-i-wanted-pipewire-tcp-server-b6016d9360c5

## Bluetooth

For displaying recognized music on the LED screen we need to install bluetooth libraries: 

```shell
sudo apt install bluetooth bluez libbluetooth-dev libudev-dev
```
