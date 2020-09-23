## homebridge-petkit-feeder-mini

## 1) Description

control your petkit feeder mini from homekit, get full use of iOS automation.

<img src="https://raw.githubusercontent.com/elfive/homebridge-petkit-feeder-mini/master/screenshot.jpg" alt="screenshot" style="zoom:33%;" />

- this plugin uses fan speed to control the meal amount, and uses the switch to commit the drop.

    

- currently this pluging for [homebridge](#https://github.com/homebridge/homebridge) just support [Petkit-feeder-mini (official store link)](#https://petkit.co.uk/product/petkit-element-mini-auto-feeder/), and this plugin currently only tested and works in Asia(include China mainland), other area may or may not work.

    ![petkit-feeder-mini](https://raw.githubusercontent.com/elfive/homebridge-petkit-feeder-mini/master/petkit-feeder-mini.jpg)

- to continuously use this plugin you should login Petkit app and never logoff, this plugin uses session id from the app and it will change every time you logoff and relogin.



## 2) Before make changes to homebridge

### Firstly, setup your Petkit mobile app.

Goto App Store, download Petkit mobile app, register, login, add device. before use this plugin you MUST make sure the app is works fine with you.

- for China mainland users, download “小佩宠物”
- for those Asia users outside China mainland, you should download "PetKit(International)"
- for users not from Asia, like America, Europe, etc. you also should download "PetKit(International)", but the API url address may not the same, this plugin may or may not works with you, if you are experienced in network, you could use "Quantumult X" to capture app network records, submit the api address to me or just create a PR or just modify this plugin for your own.



### Secondly, prepare to capture Petkit app http request.

- #### Capture on mobile: 

    you could use iOS app like "Quantumult X" or other app you like which can capture http netflow.

- #### capture on Mac:

    I did not do this on my Mac, Mac capture tutorial may available laterly. but at this time, you could just find some webpage which will help you get it done, like [this one](#https://learning.postman.com/docs/sending-requests/capturing-request-data/capturing-http-requests/).

- #### capture on Windows:

    sorry guys, I didnot have a widows device...so if you have a good tutorial, please let me know.



### Finally, retrieve infomateion.

you should provide two critical infomation to this plugin: **deviceId** and **X-Session**.

- deviceId: this value indicate which device you wanna to control.

- X-Session: this value will change every time you login you Petkit app, so do not logoff your Petkit app unless necessary. 

here is a example of Quantumult X capture data page:

<img src="https://raw.githubusercontent.com/elfive/homebridge-petkit-feeder-mini/master/quantumultX.jpg" alt="quantumultX" style="zoom: 33%;" />

you can find X-Session data from the request header area and deviceId in response data area.



## 3) Edit homebridge config.json

### config.json field

|  field   name  |  type  | required |       default        |    range    | description                                                  |
| :------------: | :----: | :------: | :------------------: | :---------: | ------------------------------------------------------------ |
|      name      | string |   yes    |  'PetkitFeederMini'  |     ---     | device name shows in HomeKit. If autoDeviceInfo is set to true, it will overwrited with the name in your Petkit app. we don't need it, but homebridge need it. |
|    location    | string |   yes    |         'cn'         | 'cn','asia' | China user:'cn'; Asia user: 'asia'; other location because lack of infomation, not support yet. |
|    headers     | array  |   yes    |         ---          |     ---     | http request headers.see more detail below(headers field)    |
|    deviceId    | string |   yes    |         ---          |     ---     | your Petkit feeder mini Id, which is buildin your device, will never change. |
|   mealAmount   |  int   |    no    |          3           |   1 to 10   | In homekit this shows as a switch, every time you click this switch it will drop mealAmount meal. This value just for initialize the fan speed after homebridge restart.  A meal stands for about 5g or 1/20 cup of food. |
| autoDeviceInfo |  bool  |    no    |        false         | true/false  | this plugin supports retrieve device info from Petkit server. Set this value to true, it can retrieve device information (timezone, name, sn, firmware), and shows it in homekit app. |
|       sn       | string |    no    |  'PetkitFeederMini'  |     ---     | serial number shows in homekit app. If autoDeviceInfo is set to true, it will overwrited with the sn of your device. |
|    firmware    | string |    no    |       '1.0.0'        |     ---     | firmware version shows in homekit app. If autoDeviceInfo is set to true, it will overwrited with the firmware version of your device. |
|  manufacturer  | string |    no    |       'Petkit'       |     ---     | the manufacturer of your device.                             |
|     model      | string |    no    | 'Petkit feeder mini' |     ---     | the model of your device.                                    |



### headers field

| field   name  |  type  | required | default  |   range   | description                                                  |
| :-----------: | :----: | :------: | :------: | :-------: | ------------------------------------------------------------ |
|   X-Session   | string |   yes    |   ---    |    ---    | Tell server who you are. This changes everytime you login Petkit app. |
| X-Api-Version | string |  prefer  | '7.18.1' |    ---    | For China mainland users, this field is not necessary, but for users outside China mainland, this field is required, but if not provided, then the default value will be used. but we recommand to fufill this field. |
|  X-Timezone   |  int   |    no    |    8     | -12 to 12 | Your local timezone offset, UTC time. If autoDeviceInfo is set to true, it will overwrited with the timezone of your device, which is set in your Petkit app. |



### example of config.json file

```json
"accessories": [{
    "accessory": "petkit_feeder_mini",
    "autoDeviceInfo": true,
    "name": "喂食器",
    "deviceId": "356367",
    "location": "asia",
    "headers": {
        "X-Session": "xxxxxx",
        "X-Timezone": 8
    }
}]
```



## 4) How to contribute

everyone is welcome to contribute to this plugin. PR/debug/api help all are welcome.