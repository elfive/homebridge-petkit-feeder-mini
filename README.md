## Important announcement!!!

- Due to a company named “寻猫记” (which is 100% holding by 小佩, aka petkit in China), involved into some sort of selling cats issue (maybe not illegal, but in a very disgusting way) and I'm not happy with it, if you know to read Chinese, you can find out more detailed info at [this web page](https://zhuanlan.zhihu.com/p/426790315).
- so here is my announcement:

```
1. permanently stop this plugin develop ,unpublish from npmjs.com and no more further issue will be answerd.
```

```
2. highly recommended you the pet owner and pet lovers stop buying any petkit products.
```

```
3. it better feed your soul mate with natural food, like raw meat or dried meat.
```

```
4. thank you for your support.
```

## homebridge-petkit-feeder-mini

<p align="center">
  <img src="https://raw.githubusercontent.com/elfive/homebridge-petkit-feeder-mini/master/images/petkit-feeder-mini.jpg">
  <br>
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
  <strong><a href="#2-how-to-setup">Setup Guide</a> | <a href="#4-how-to-contribute">Contribute</a> </strong>
</p>


## 1) Description

control your petkit feeder mini from homekit, get full use of iOS automation.

<p align="center">
  <img src="https://raw.githubusercontent.com/elfive/homebridge-petkit-feeder-mini/master/images/screenshot.jpg" alt="screenshot" /><img src="https://raw.githubusercontent.com/elfive/homebridge-petkit-feeder-mini/master/images/screenshot2.jpg" alt="screenshot2" />
  <br>
  <img src="https://raw.githubusercontent.com/elfive/homebridge-petkit-feeder-mini/master/images/screenshot3.jpg" alt="screenshot3" /><img src="https://raw.githubusercontent.com/elfive/homebridge-petkit-feeder-mini/master/images/screenshot4.jpg" alt="screenshot4" />
</p>



### features

- uses a fan speed to control the meal amount;
- uses a switch to commit the drop;
- uses a switch to control the Petkit feeder mini light mode;
- uses a switch to control the Petkit feeder mini manual lock;
- uses a occupancy to indicate food storage status;
- uses a filter maintenance to indicate desiccant status(include auto reset desiccant left days, this may not show in homekit);
- uses a battery service to indicate device power status(only for Petkit Feeder Mini, include power level, charging status and low battery alert in Homekit)
- can fetch device info from Petkit server and shows in Homekit.



### limitations

- enable/disable meal plan for the day(may be in the next major version, currently no plan to do it).
- currently this plugin for <a href="https://github.com/homebridge/homebridge">homebridge</a> just tested with <a href="https://petkit.co.uk/product/petkit-element-mini-auto-feeder/">Petkit-feeder-mini (official store link)</a>, and this plugin currently only tested and works in Asia(include China mainland) and North America, other area may need more work.
- to continuously use this plugin you should login Petkit app and never logoff, this plugin uses session id from the app and it will change every time you logoff and relogin.
- because version 2.x.x is developed on a dynamic platform plugin, and not implement auto remove deleted device(s), so you may need to delete cached accessories manually.
- ......




## 2) How to setup

### Firstly, setup your Petkit mobile app.

Goto App Store, download Petkit mobile app, register, login, add device. before use this plugin you <strong>MUST</strong> make sure the app works fine with you.

- for China mainland users, download “小佩宠物”
- for those Asia users outside China mainland, you should download "PetKit(International)"
- for users not from Asia, like America, Europe, etc. you also should download "PetKit(International)", but the API url address may not the same, this plugin may or may not works with you, if you are experienced in network, you could use "Quantumult X" to capture app network records, submit the api address to me or just create a PR or just modify this plugin for your own.



### Secondly, prepare to capture Petkit app http request.

Please goto <a href="https://github.com/elfive/homebridge-petkit-feeder-mini/wiki#how-to-capture-http-netflow">this</a> wiki page to find more detail.

### Finally, retrieve infomation.

you should provide one critical infomation to this plugin: **X-Session**, if you have more than one Petkit feeder mini device, then you should alse provide **deviceId** in the header field of the config.json file.

Be aware of that, to minimize the effect to the Petkit server with unnecessary http requests, the plugin just update device status more than 10s interval, which means the status will bufferd at lease 10s. 

- X-Session: this value will change every time you login you Petkit app, so do not logoff your Petkit app unless necessary. 
- deviceId: this value indicate which device you wanna to control. If you just have one Petkit feeder mini, you can ignore this value.

here is a example of Quantumult X capture data page:

<p align="center"><img src="https://raw.githubusercontent.com/elfive/homebridge-petkit-feeder-mini/master/images/quantumultX.jpg" alt="quantumultX" /></p>
you can find X-Session data from the request header area and deviceId in response data area.



## 3) Configure

### config.json field

| field   name |  type  | required |       default        |        range         | description                                                  |
| :----------: | :----: | :------: | :------------------: | :------------------: | :----------------------------------------------------------- |
|   platform   | string |   yes    | 'petkit_feeder_mini' | 'petkit_feeder_mini' | Must be 'petkit_feeder_mini' in order to use this plugin.    |
|  log_level   |  int   |    no    |          2           |      1,2,3,4,9       | one of these values:<br/>- 1: Debug<br/>- 2: Info<br/>- 3: Warn<br/>- 4: Error<br/>- 9: None |
|   devices    | object |   yes    |         ---          |         ---          | Petkit Feeder device config.<br/>See more detail info at <a href="#devices field">decices field</a> below. |



### devices field

|           field   name            |  type  | required |                  default                   |                range                | description                                                  |
| :-------------------------------: | :----: | :------: | :----------------------------------------: | :---------------------------------: | ------------------------------------------------------------ |
|             location              | string |   yes    |                    'cn'                    | 'cn',<br>'asia',<br>'north_america' | China users:'cn';<br>Asia users: 'asia';<br>North America users: 'north_america';<br>other location because lack of infomation, not sure it will work.<br/>You can find more info <a href="https://github.com/elfive/homebridge-petkit-feeder-mini/wiki/How-to-choose-server-location">here</a>. |
|               model               | string |    no    |                'FeederMini'                |      'FeederMini',<br>'Feeder'      | Petkit Feeder Mini: 'FeederMini'<br>Petkit Feeder Element: 'Feeder' |
|             deviceId              | string |   tbd    |                    ---                     |                 ---                 | your Petkit feeder mini Id, which is buildin your device, will never change. <br/>If you just have one Petkit feeder device, you can ignore this value.<br/>If you just have more than one Petkit Feeder device, you must set this value. |
|              headers              | array  |   yes    |                    ---                     |                 ---                 | http request headers.<br/>See more detail info at <a href="#headers field">headers field</a> below. |
|         enable_http_retry         |        |    no    |                   false                    |             true/false              | Enable or disable HTTP retry function, useful when your device or homebridge has a bad internet connection. |
|         http_retry_count          |  int   |    no    |                     3                      |               1 to 5                | max retry times when a http request failed.                  |
|           DropMeal_name           | string |    no    |                 'DropMeal'                 |                 ---                 | name of DropMeal switch in HomeKit.                          |
|          MealAmount_name          | string |    no    |                'MealAmount'                |                 ---                 | name of MealAmount fan speed in HomeKit.                     |
|         FoodStorage_name          | string |    no    | 'FoodStorage_Empty'<br>or<br>'FoodStorage' |                 ---                 | name of FoodStorage indicator in HomeKit.<br>Note: if reverse_foodStorage_indicator value is set to true, then the default name is 'FoodStorage_Empty', otherwise 'FoodStorage' |
|        DesiccantLevel_name        | string |    no    |              'DesiccantLevel'              |                 ---                 | name of DesiccantLevel indicator in HomeKit.                 |
|          ManualLock_name          | string |    no    |                'ManualLock'                |                 ---                 | name of ManualLock switch in HomeKit.                        |
|          LightMode_name           | string |    no    |                'LightMode'                 |                 ---                 | name of LightMode switch in HomeKit.                         |
|           Battery_name            | string |    no    |                 'Battery'                  |                 ---                 | name of Battery indicator in HomeKit.                        |
|          enable_polling           |  bool  |    no    |                    true                    |             true/false              | Automatically update device info from Petkit server.         |
|         polling_interval          |  int   |    no    |                     60                     |             60 to 3600              | update device info interval from Petkit server(s).           |
|         enable_manualLock         |  bool  |    no    |                   false                    |             true/false              | if enabled, a switch will show in homekit to control the manual lock of the feeder. |
|         enable_lightMode          |  bool  |    no    |                   false                    |             true/false              | if enabled, a switch will show in homekit to control the lighe mode of the feeder. |
| reverse_foodStorage<br>_indicator |  bool  |    no    |                   false                    |             true/false              | normally, the occupancy will show an alert in homekit when there is enough food in the feeder, in which situation may not so recognizable, so you can reverse the status bu set this value to true, so when there is not much food, it can show an alert in homekit. |
| ignore_battery_when<br/>_charging |  bool  |    no    |                   false                    |             true/false              | Ignore battery low level alerm when device connected to a power source.<br>And battery function is disabled when using a Petkit Feeder Element device. |
|           fast_response           |  bool  |    no    |                   false                    |             true/false              | if set to true, then when received a Homekit set request, return immediately, ignore the result.<br>this is useful when your homebridge or Petkit device has a bad internet connection. |



### headers field

| field   name  |  type  | required | default  |   range   | description                                                                                                                                                                                                       |
| :-----------: | :----: | :------: | :------: | :-------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   X-Session   | string |   yes    |   ---    |    ---    | Tell server who you are. This changes everytime you login Petkit app.                                                                                                                                             |
| X-Api-Version | string |  prefer  | '7.18.1' |    ---    | For China mainland users, this field is not necessary, but for users outside China mainland, this field is optional, if not provided, then the default value will be used. but we recommand to fufill this field. |
|  X-Timezone   |  int   |    no    |    8     | -12 to 12 | Your local timezone offset, UTC time. If autoDeviceInfo is set to true, it will overwrited with the timezone of your device, which is set in your Petkit app.                                                     |

we recomand you entered all the headers you captured. If you don't want to do so, please ensure header "X-Session" is correctly entered.



### example of config.json file

```json
"platforms": [{
  "log_level": 2,
  "devices": [
      {
        "headers": [
          {
            "key": "X-Session",
            "value": "xxxxxx"
          }
        ],
        "location": "cn",
        "model": "FeederMini",
        "enable_http_retry": false,
        "http_retry_count": 3,
        "DropMeal_name": "DropMeal",
        "MealAmount_name": "MealAmount",
        "FoodStorage_name": "FoodStorage",
        "DesiccantLevel_name": "DesiccantLevel",
        "ManualLock_name": "ManualLock",
        "LightMode_name": "LightMode",
        "Battery_name": "Battery",
        "enable_polling": true,
        "polling_interval": 60,
        "enable_desiccant": true,
        "alert_desiccant_threshold": 7,
        "enable_autoreset_desiccant": true,
        "reset_desiccant_threshold": 5,
        "enable_manualLock": true,
        "enable_lightMode": true,
        "reverse_foodStorage_indicator": true,
        "fast_response": true
      }
  ],
  "platform": "petkit_feeder_mini"
}]
```


