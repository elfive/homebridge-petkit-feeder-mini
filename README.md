## homebridge-petkit-feeder-mini

<p align="center">
  <a href="https://www.npmjs.com/package/homebridge-petkit-feeder-mini">
    <img src="https://flat.badgen.net/npm/v/homebridge-petkit-feeder-mini" alt="NPM Version" />
  </a>
  <a href="https://www.npmjs.com/package/homebridge-petkit-feeder-mini">
    <img src="https://flat.badgen.net/npm/dt/homebridge-petkit-feeder-mini" alt="Total NPM Downloads" />
  </a>
  <a href="https://github.com/homebridge/homebridge/wiki/Verified-Plugins">
    <img src="https://flat.badgen.net/badge/homebridge/verified/purple" alt="Verified by Homebridge" />
  </a>
  <br>
  <strong><a href="#2) Before make changes to homebridge">Quick Start</a> | <a href="#4) How to contribute">Contribute</a> </strong>
</p>

## 1) Description

control your petkit feeder mini from homekit, get full use of iOS automation.

<img src="https://raw.githubusercontent.com/elfive/homebridge-petkit-feeder-mini/master/images/screenshot.jpg" alt="screenshot" /><img src="https://raw.githubusercontent.com/elfive/homebridge-petkit-feeder-mini/master/images/screenshot2.jpg" alt="screenshot2" />

<img src="https://raw.githubusercontent.com/elfive/homebridge-petkit-feeder-mini/master/images/screenshot3.jpg" alt="screenshot3" /><img src="https://raw.githubusercontent.com/elfive/homebridge-petkit-feeder-mini/master/images/screenshot4.jpg" alt="screenshot4" />

- features
    - what's this plugin can do:

        - uses a fan speed to control the meal amount;
        - uses a switch to commit the drop;
        - uses a switch to control the Petkit feeder mini light mode;
        - uses a switch to control the Petkit feeder mini manual lock;
        - uses a occupancy to indicate food storage status;
        - uses a filter maintenance to indicate desiccant status(include auto reset desiccant left days, this may not show in homekit);
        - uses a battery service to indicate device power status(include power level, charging status and low battery alert in Homekit)
        - can fetch device info from Petkit server and shows in Homekit.

          

    - what's this plugin can't do:

        - set a timed meal(may never support it, because you can just use homekit automation to do it.);
        - enable/disable meal plan for the day(may be in the next major version, currently no plan to do it).
        - ......



- currently this plugin for [homebridge](#https://github.com/homebridge/homebridge) just support [Petkit-feeder-mini (official store link)](#https://petkit.co.uk/product/petkit-element-mini-auto-feeder/), and this plugin currently only tested and works in Asia(include China mainland), other area may or may not working properly.

    ![petkit-feeder-mini](https://raw.githubusercontent.com/elfive/homebridge-petkit-feeder-mini/master/images/petkit-feeder-mini.jpg)

- to continuously use this plugin you should login Petkit app and never logoff, this plugin uses session id from the app and it will change every time you logoff and relogin.



## 2) Before make changes to homebridge

### Firstly, setup your Petkit mobile app.

Goto App Store, download Petkit mobile app, register, login, add device. before use this plugin you MUST make sure the app works fine with you.

- for China mainland users, download “小佩宠物”
- for those Asia users outside China mainland, you should download "PetKit(International)"
- for users not from Asia, like America, Europe, etc. you also should download "PetKit(International)", but the API url address may not the same, this plugin may or may not works with you, if you are experienced in network, you could use "Quantumult X" to capture app network records, submit the api address to me or just create a PR or just modify this plugin for your own.



### Secondly, prepare to capture Petkit app http request.

- Capture on mobile: 

    you could use iOS app like "Quantumult X" or other app you like which can capture http netflow.

- capture on Mac:

    I did not do this on my Mac, Mac capture tutorial may available laterly. but at this time, you could just find some webpage which will help you get it done, like [this one](#https://learning.postman.com/docs/sending-requests/capturing-request-data/capturing-http-requests/).

- capture on Windows:

    sorry guys, I didnot have a widows device...so if you have a good tutorial, please let me know.



### Finally, retrieve infomateion.

you should provide one critical infomation to this plugin: **X-Session**, if you have more than one Petkit feeder mini device, then you should alse provide **deviceId** in the header field of the config.json file.

be aware of that, to minimize the effect to the Petkit server with unnecessary http requests, the plugin just update device status more than 10s interval, which means the status will bufferd at lease 10s. 

- X-Session: this value will change every time you login you Petkit app, so do not logoff your Petkit app unless necessary. 
- deviceId: this value indicate which device you wanna to control. If you just have one Petkit feeder mini, you can not provide this value.

here is a example of Quantumult X capture data page:

<img src="https://raw.githubusercontent.com/elfive/homebridge-petkit-feeder-mini/master/images/quantumultX.jpg" alt="quantumultX" />

you can find X-Session data from the request header area and deviceId in response data area.



## 3) Edit homebridge config.json

### config.json field

|                name                |  type  | required |       default        |    range    | description                                                  |
| :--------------------------------: | :----: | :------: | :------------------: | :---------: | ------------------------------------------------------------ |
|                name                | string |   yes    |  'PetkitFeederMini'  |     ---     | device name shows in HomeKit. If autoDeviceInfo is set to true, it will overwrited with the name in your Petkit app. we don't need it, but homebridge need it. |
|              location              | string |   yes    |         'cn'         | 'cn','asia' | China user:'cn'; Asia user: 'asia'; other location because lack of infomation, not sure it will work. |
|              headers               | array  |   yes    |         ---          |     ---     | http request headers.see more detail below(headers field)    |
|              deviceId              | string |   tbd    |         ---          |     ---     | your Petkit feeder mini Id, which is buildin your device, will never change. If you just have one Petkit feeder mini, you can ignore this value. |
|             mealAmount             |  int   |    no    |          3           |   0 to 10   | In homekit this shows as a switch, every time you click this switch it will drop mealAmount of meal. This value just for initialize the fan speed after homebridge restart.  A meal stands for about 5g or 1/20 cup of food. Every 10% fan speed equals 1 meal. |
|           autoDeviceInfo           |  bool  |    no    |        false         | true/false  | this plugin supports retrieve device info from Petkit server. Set this value to true, it can retrieve device information (timezone, name, sn, firmware), and shows it in homekit app. |
|                 sn                 | string |    no    |  'PetkitFeederMini'  |     ---     | serial number shows in homekit app. If autoDeviceInfo is set to true, it will overwrited with the sn of your device. |
|              firmware              | string |    no    |       '1.0.0'        |     ---     | firmware version shows in homekit app. If autoDeviceInfo is set to true, it will overwrited with the firmware version of your device. |
|            manufacturer            | string |    no    |       'Petkit'       |     ---     | the manufacturer of your device.                             |
|               model                | string |    no    | 'Petkit feeder mini' |     ---     | the model of your device.                                    |
|           enable_polling           |  bool  |    no    |         true         | true/false  | Automatically update device info from Petkit server.         |
|          polling_interval          |  int   |    no    |          60          | 60 to 3600  | update device info interval from Petkit server(ms).          |
| reverse_food_<br>storage_indicator |  bool  |    no    |        false         | true/false  | normally, the occupancy will show an alert in homekit when there is enough food in the feeder, in which situation may not so recognizable, so you can reverse the status bu set this value to true, so when there is not much food, it can show an alert in homekit. |



### headers field

| field   name  |  type  | required | default  |   range   | description                                                  |
| :-----------: | :----: | :------: | :------: | :-------: | ------------------------------------------------------------ |
|   X-Session   | string |   yes    |   ---    |    ---    | Tell server who you are. This changes everytime you login Petkit app. |
| X-Api-Version | string |  prefer  | '7.18.1' |    ---    | For China mainland users, this field is not necessary, but for users outside China mainland, this field is required, but if not provided, then the default value will be used. but we recommand to fufill this field. |
|  X-Timezone   |  int   |    no    |    8     | -12 to 12 | Your local timezone offset, UTC time. If autoDeviceInfo is set to true, it will overwrited with the timezone of your device, which is set in your Petkit app. |

we recomand you entered all the headers you captured. If you don't want to do so, please ensure header "X-Session" is correctly entered.



### example of config.json file

```json
"accessories": [{
    "accessory": "petkit_feeder_mini",
    "autoDeviceInfo": true,
    "name": "feeder",
    "deviceId": "123456",
    "location": "asia",
    "reverse_food_storage_indicator": false
    "headers": [
        {
            "key": "X-Session",
            "value": "xxxxxx"
        },
        {
            "key": "X-Timezone",
            "value": "8"
        }
    ]
}]
```



## 4) How to contribute

everyone is welcome to contribute to this plugin. PR/issue/debug all are welcome.
