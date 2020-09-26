'use strict';

let Service, Characteristic;

const request = require('request');
const request_sync = require('urllib-sync').request;
const format = require('string-format');
const dayjs = require('dayjs');
const pollingtoevent = require('polling-to-event');

const support_settings = Object.freeze({
    'manualLock' : 'settings.manualLock',      // 1 for off, 0 for on
});

const global_urls = Object.freeze({
    'cn': {
        'deviceState': 'http://api.petkit.cn/6/feedermini/devicestate?id={}',
        'deviceDetail': 'http://api.petkit.cn/6/feedermini/device_detail?id={}',
        'saveDailyFeed': 'http://api.petkit.cn/6/feedermini/save_dailyfeed?deviceId={}&day={}&time={}&amount={}',
        'removeDailyFeed': 'http://api.petkit.cn/6/feedermini/remove_dailyfeed?deviceId={}&day={}&id=d{}',
        'dailyfeeds': 'http://api.petkit.cn/6/feedermini/dailyfeeds?deviceId={}&days={}',
        'restoreDailyFeeds': 'http://api.petkit.cn/6/feedermini/restore_dailyfeed?deviceId={}&day={}&id=s{}',
        'disableDailyFeeds': 'http://api.petkit.cn/6/feedermini/remove_dailyfeed?deviceId={}&day={}&id=s{}',
        'resetDesiccant': 'http://api.petkit.cn/6/feedermini/desiccant_reset?deviceId={}',
        'updateSettings': 'http://api.petkit.cn/6/feedermini/update?id={}&kv={}',
        'owndevices': 'http://api.petkit.cn/6/discovery/device_roster',
    },
    'asia':{
        'deviceState': 'http://api.petktasia.com/latest/feedermini/devicestate?id={}',
        'deviceDetail': 'http://api.petktasia.com/latest/feedermini/device_detail?id={}',
        'saveDailyFeed': 'http://api.petktasia.com/latest/feedermini/save_dailyfeed?deviceId={}&day={}&time={}&amount={}',
        'removeDailyFeed': 'http://api.petktasia.com/latest/feedermini/remove_dailyfeed?deviceId={}&day={}&id=d{}',
        'dailyfeeds': 'http://api.petktasia.com/latest/feedermini/dailyfeeds?deviceId={}&days={}',
        'restoreDailyFeeds': 'http://api.petktasia.com/latest/feedermini/restore_dailyfeed?deviceId={}&day={}&id=s{}',
        'disableDailyFeeds': 'http://api.petktasia.com/latest/feedermini/remove_dailyfeed?deviceId={}&day={}&id=s{}',
        'resetDesiccant': 'http://api.petktasia.com/latest/feedermini/desiccant_reset?deviceId={}',
        'updateSettings': 'http://api.petktasia.com/latest/feedermini/update?id={}&kv={}',
        'owndevices': 'http://api.petktasia.com/latest/discovery/device_roster',
    }
});

const min_amount = 0;
const max_amount = 10;
const min_desiccantLeftDays = 0;
const max_desiccantLeftDays = 30;
const min_batteryLevel = 0;
const max_batteryLevel = 4;
const min_pollint_interval = 60;
const max_pollint_interval = 3600;
const reset_desiccant_threshold = 5;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory('homebridge-petkit-feeder-mini', 'petkit_feeder_mini', petkit_feeder_mini_plugin);
}

function petkit_feeder_mini_plugin(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.deviceDetailInfo = {};
    this.poolToEventEmitter = null;

    this.log('begin to initialize petkit feeder mini.');

    if (!this.config['location'] || !global_urls[this.config['location']]) {
        this.log.error('wrong value in config.json file: location.');
        return;
    }
    this.urls = global_urls[this.config['location']];

    if (!this.config['headers']) {
        this.log.error('missing field in config.json file: headers.');
        return;
    }
    this.headers = this.convertHeadersetFormat(this.config['headers']);
    switch(this.config['location']) {
        case 'cn':
            if (!this.headers['X-Session']) {
                this.log.error('missing field in config.json file: headers.X-Session.');
                return;
            }
            break;
        case 'asia':
            if (!this.headers['X-Session']) {
                this.log.error('missing field in config.json file: headers.X-Session.');
                return;
            }
            if (!this.headers['X-Api-Version']) {
                this.headers['X-Api-Version'] = '7.18.1';
                this.log('missing field in config.json file: headers.X-Api-Version, using "' + this.headers['X-Api-Version'] + '" instead.');
            }
            break;
        default:
        this.log.error('wrong value in config.json file: location.');
        return;
    }

    // handle device connection info
    this.userAgent = this.config['userAgent'] || 'PetKit/7.19.1 (iPhone; iOS 14.0; Scale/3.00)';

    // make sure deviceId is correct or get the deviceId
    this.deviceId = this.config['deviceId'];
    const devices = this.praseGetDeviceResult(this.getDevicesFromServer());
    if (devices) {
        if (devices.length === 1) {
            this.log.debug(JSON.stringify(devices[0]));
            if (!this.deviceId) {
                this.log('found you just ownd one feeder mini with deviceId: '+ devices[0].id);
                this.deviceId = devices[0].id;
            } else if (devices[0].id != this.deviceId) {
                this.log.warn('seems that you does not ownd a feeder mini with deviceId: '+ this.deviceId);
                this.log.warn('use '+ devices[0].id + ' instead ' + this.deviceId);
                this.deviceId = devices[0].id;
            }
        } else {
            const devicesIds = devices.map(function(device){
                return {'id': device.id, 'name': device.name};
            });
            this.log.error('seems that you does not ownd more than one feeder mini');
            this.log.error('do you mean one of this: '+ JSON.stringify(devicesIds));
            return;
        }
    }

    // handle feed settings
    // meal, same as petkit app unit. one share stands for 5g or 1/20 cup, ten meal most;
    this.mealAmount = this.config['mealAmount'] || 3;
    if (this.config['mealAmount'] > max_amount) {
        this.log('mealAmount should not greater than ' + max_amount + ', use ' + max_amount + ' instead');
        this.mealAmount = max_amount;
    } else if (this.config['mealAmount'] < min_amount) {
        this.log('mealAmount should not less than ' + min_amount + ', use ' + min_amount + ' instead');
        this.mealAmount = min_amount;
    }

    this.manufacturer = this.config['manufacturer'] || 'Petkit';
    this.model = this.config['model'] || 'Petkit feeder mini';

    this.alertDesiccantLeftDays = this.config['alert_desiccantLeftDays'] || 5;

    this.log('petkit feeder mini loaded successfully.');
}

petkit_feeder_mini_plugin.prototype = {
    getServices: function() {
        var services = [];
        this.getDeviceDetailInfoFromServer();

        if (this.config['autoDeviceInfo']) {
            this.name = this.deviceDetailInfo['name'] || this.config['name'] || 'PetkitFeederMini';
            this.serialNumber = this.deviceDetailInfo['sn'] || this.config['sn'] || 'PetkitFeederMini';
            this.firmware = this.deviceDetailInfo['firmware'] || this.config['firmware'] || '1.0.0';
        } else {
            this.name = this.config['name'] || 'PetkitFeederMini';
            this.serialNumber = this.config['sn'] || 'PetkitFeederMini';
            this.firmware = this.config['firmware'] || '1.0.0';
        }

        // meal drop service
        this.drop_meal_service = new Service.Switch(this.name + 'DropMeal', 'DropMeal');
        this.drop_meal_service.getCharacteristic(Characteristic.On)
            .on('get', function(callback) {
                const currentValue = 0;
                callback(null, currentValue);
            }.bind(this))
            .on('set', this.hb_dropMeal_set.bind(this));
        services.push(this.drop_meal_service);

        // meal amount setting
        this.meal_amount_service = new Service.Fan(this.name + 'MealAmount', 'MealAmount');
        this.meal_amount_service.getCharacteristic(Characteristic.On)
            .on('get', function(callback) {
                callback(null, this.mealAmount != 0);
            }.bind(this));
        this.meal_amount_service.getCharacteristic(Characteristic.RotationSpeed)
            .on('get', function(callback) {
                callback(null, this.mealAmount);
            }.bind(this))
            .on('set', function(value, callback) {
                this.mealAmount = value;
                this.log('set meal amount to ' + value);
                callback(null);
            }.bind(this))
            .setProps({
                minValue: min_amount,
                maxValue: max_amount,
                minStep: 1
            });
        services.push(this.meal_amount_service);

        // food storage indicator
        this.food_storage_service = new Service.OccupancySensor(this.name + 'FoodStorage', 'FoodStorage');
        this.food_storage_service.getCharacteristic(Characteristic.OccupancyDetected)
            .on('get', this.hb_foodStorageStatus_get.bind(this));
        var food_storage_status = this.deviceDetailInfo['food'] || 0;
        this.food_storage_service.setCharacteristic(Characteristic.OccupancyDetected, food_storage_status)
        services.push(this.food_storage_service);

        // desiccant left days
        var desiccantLeftDays = this.deviceDetailInfo['desiccantLeftDays'] || max_desiccantLeftDays;
        this.desiccant_level_service = new Service.FilterMaintenance(this.name + 'DesiccantLevel', 'DesiccantLevel');
        this.desiccant_level_service.getCharacteristic(Characteristic.FilterChangeIndication)
            .on('get', this.hb_desiccantIndicator_get.bind(this));
        this.desiccant_level_service.getCharacteristic(Characteristic.FilterLifeLevel)
            .on('get', this.hb_desiccantLeftDays_get.bind(this))
            .setProps({
                minValue: min_desiccantLeftDays,
                maxValue: max_desiccantLeftDays,
                minStep: 1
            });
        this.desiccant_level_service.getCharacteristic(Characteristic.ResetFilterIndication)
            .on('set', this.hb_desiccantLeftDays_reset.bind(this))
        services.push(this.desiccant_level_service);

        // manualLock setting
        var manualLock = this.deviceDetailInfo['manualLock'] || 0;      // default not lock
        this.manualLock_service = new Service.Switch(this.name + 'ManualLock', 'ManualLock');
        this.manualLock_service.getCharacteristic(Characteristic.On)
            .on('get', function(callback) {
                const currentValue = this.deviceDetailInfo['manualLock'] || 0;
                callback(null, currentValue ? 0 : 1);// on for off, off for on, same behavior with Petkit app.
            }.bind(this))
            .on('set', this.hb_manualLockStatus_set.bind(this));
        services.push(this.manualLock_service);

        // battery status
        this.battery_status_service = new Service.BatteryService(this.name + 'Battery', 'Battery');
        this.battery_status_service.getCharacteristic(Characteristic.BatteryLevel)
            .on('get', this.hb_deviceBatteryLevel_get.bind(this));
        this.battery_status_service.getCharacteristic(Characteristic.ChargingState)
            .on('get', this.hb_deviceChargingState_get.bind(this));
        this.battery_status_service.getCharacteristic(Characteristic.StatusLowBattery)
            .on('get', this.hb_deviceStatusLowBattery_get.bind(this));
        services.push(this.battery_status_service);

        // divice information
        this.info_service = new Service.AccessoryInformation();
        this.info_service
            .setCharacteristic(Characteristic.Identify, this.deviceId)
            .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
            .setCharacteristic(Characteristic.Model, this.model)
            .setCharacteristic(Characteristic.SerialNumber, this.serialNumber)
            // infomation below changed from petkit app require a homebridge reboot to take effect.
            .setCharacteristic(Characteristic.Name, this.name)
            .setCharacteristic(Characteristic.FirmwareRevision, this.firmware);
        services.push(this.info_service);

        // polling
        this.enable_polling = this.config['enable_polling'] || true;
        if (this.enable_polling) {
            // enable_polling between 5min to 1day, default 5min
            this.polling_interval = this.config['polling_interval'] || min_pollint_interval;
            if (this.polling_interval < min_pollint_interval) {
                this.log.warn('polling interval should greater than ' + min_pollint_interval + '(' + min_pollint_interval / 60 +' min), change to ' + min_pollint_interval + '.');
                this.polling_interval = min_pollint_interval;
            } else if (this.polling_interval > max_pollint_interval) {
                this.log.warn('polling interval should less than ' + max_pollint_interval + '(' + max_pollint_interval / 60 +' min), change to ' + max_pollint_interval + '.');
                this.polling_interval = max_pollint_interval;
            }
            const polling_options = {
                longpolling: true,
                interval: this.polling_interval * 1000,
                longpollEventName: 'deviceStatusUpdatePoll'
            };
            this.poolToEventEmitter = pollingtoevent(function(done) {
                this.log('start polling...');
                this.getDeviceDetailInfoFromServer(function(status_info) {
                    done(null, status_info)
                }.bind(this));
            }.bind(this), polling_options);

            this.poolToEventEmitter.on('deviceStatusUpdatePoll', function(status_info) {
                this.updateHomebridgeStatus(status_info);
            }.bind(this));
        }

        return services;
    },

    convertHeadersetFormat: function(config_headers) {
        var post_headers = {};
        config_headers.forEach(function(header, index) {
            post_headers[header.key] = header.value;
        });
        this.log.debug(post_headers);
        return post_headers;
    },

    praseSaveDailyFeedResult: function(jsonStr) {
        const jsonObj = JSON.parse(jsonStr);
        if (!jsonObj) {
            log.warn('JSON.parse error with:' + jsonStr);
            return false;
        }

        if (jsonObj.hasOwnProperty('error')) {
            this.log.warn(jsonObj.error.msg);
            return false;
        }

        if (!jsonObj.hasOwnProperty('result')) {
            this.log.warn('JSON.parse error with:' + jsonStr);
            return false;
        }

        if (jsonObj.result.isExecuted == 1) {
            return true;
        }

        return false;
    },

    praseGetDeviceResult: function(jsonStr) {
        const jsonObj = JSON.parse(jsonStr);
        if (!jsonObj) {
            this.log.warn('JSON.parse error with:' + jsonStr);
            return false;
        }

        if (!jsonObj.hasOwnProperty('result')) {
            this.log.warn('JSON.parse error with:' + jsonStr);
            return false;
        }

        if (!jsonObj.result.hasOwnProperty('devices')) {
            this.log.warn('JSON.parse error with:' + jsonStr);
            return false;
        }

        if (jsonObj.result.devices.length == 0) {
            this.log('seems you\'re not owned a device.');
            return false;
        }

        var devices = [];
        jsonObj.result.devices.forEach(function(item, index) {
            if (item.type == 'FeederMini' && item.data) {
                devices.push(item.data);
            }
        }.bind(this));

        if (devices.length == 0) {
            this.log('seems you nots owned a Petkit feeder mini, this plugin only works for Petkit feeder mini, sorry.');
            return false;
        }

        return devices;
    },

    praseUpdateDeviceSettingsResult: function(jsonStr) {
        const jsonObj = JSON.parse(jsonStr);
        if (!jsonObj) {
            this.log.warn('JSON.parse error with:' + jsonStr);
            return false;
        }

        if (jsonObj.hasOwnProperty('error')) {
            this.log.warn(jsonObj.error.msg);
            return false;
        }

        if (!jsonObj.hasOwnProperty('result')) {
            this.log.warn('JSON.parse error with:' + jsonStr);
            return false;
        }

        return (jsonObj.result == 'success');
    },

    // date：20200920、time: 68400
    confirmSaveFeedSuccess: function(date, time) {
        const jsonStr = this.getDailyFeedsInfoFromServer(date);
        const jsonObj = JSON.parse(jsonStr);
        if (!jsonObj) {
            this.log('JSON.parse error with:' + jsonStr);
            return false;
        }

        if (!jsonObj.hasOwnProperty('result')) {
            return false;
        }

        return !jsonObj.result.every(function(reult) {
            return reult.items.every(function(item) {
                // item id start char: s for static plan, r for temp add, d for timed add plan
                return (item.id != 'd' + time || item.id != 's' + time || item.id.startsWith('r' + time + '-'));
            });
        });
    },

    // date：20200920、time: 68400
    confirmRemoveFeedSuccess: function(date, time) {
        const jsonStr = this.getDailyFeedsInfoFromServer(date);
        const jsonObj = JSON.parse(jsonStr);
        if (!jsonObj) {
            this.log('JSON.parse error with:' + jsonStr);
            return false;
        }

        if (!jsonObj.hasOwnProperty('result')) {
            return false;
        }

        return jsonObj.result.every(function(reult) {
            return reult.items.every(function(item) {
                // item id start char: s for static plan, r for temp add, d for timed add plan
                return (item.id != 'd' + time || item.id != 's' + time || item.id.startsWith('r' + time + '-'));
            });
        });
    },

    post: function(url, callback = null) {
        this.log.debug(url);
        const options = {
          url: url,
          method: 'POST',
          headers: this.headers
        };
        if (callback) {
            try {
                request(options, function(error, response, data) {
                    if (!error && response.statusCode == 200) {
                        callback(data);
                    } else {
                        this.log.error(response.statusCode + ': ' + error);
                        callback(false);
                    }
                }.bind(this));
            } catch(e) {
                this.log.error('we had a problem to post request: ' + e);
                callback(false);
            }
        } else {
            try {
                var response = request_sync(options.url, options);
                if (response.status == 200) {
                    return response.data.toString();
                }
                this.log.error(response.statusCode + ': ' + error);
                return false;
            } catch(e) {
                this.log.error('we had a problem to post request: ' + e);
                return false;
            }
        }
    },

    getDevicesFromServer: function(callback = null) {
        return this.post(this.urls.owndevices, callback);
    },

    getDeviceBriefInfoFromServer: function(callback = null) {
        // {
        //     "result": {
        //         "batteryPower":4,"batteryStatus":0,"desiccantLeftDays":6,
        //         "errorPriority":0,"feeding":0,"food":1,"ota":0,"overall":1,
        //         "pim":1,"runtime":49677,"wifi":{
        //             "bssid":"xxxxxxxxxxxx","rsq":-37,"ssid":"xxxxxxxxxx"
        //         }
        //     }
        // }
        return this.post(format(this.urls.deviceState, this.deviceId), callback);
    },

    getDeviceDetailInfoFromServer: function(callback = null) {
        const getDeviceDetailFromServer = function (callback = null) {
            // {"result":{"createdAt":"2020-05-26T12:48:29.158Z","feed":{"deviceId":356367,"isExecuted":1,"isLock":1,"items":[{"amount":15,"id":"43200","name":"\u5348\u9910","petAmount":[{"amount":15,"petId":"770000"}],"time":43200}],"repeats":"1,2,3,4,5,6,7","suspended":0,"userId":"xxxxxx"},"firmware":"1.394","firmwareDetails":[{"module":"userbin","version":2003001}],"hardware":1,"id":356367,"locale":"Asia\/Shanghai","mac":"xxxxxxxxxxxx","name":"\u667A\u80FD\u5582\u98DF\u5668","relation":{"petIds":["xxxxxx"],"userId":"xxxxxx"},"secret":"xxxxxx","settings":{"desiccantNotify":0,"feedNotify":1,"foodNotify":1,"lightMode":0,"lightRange":[0,1440],"manualLock":0,"reBatteryNotify":1},"shareOpen":0,"signupAt":"2020-09-20T18:05:39.269Z","sn":"xxxx","state":{"batteryPower":4,"batteryStatus":0,"desiccantLeftDays":6,"errorPriority":0,"feeding":0,"food":1,"ota":0,"overall":1,"pim":1,"runtime":49677,"wifi":{"bssid":"xxxxxxxxxxxx","rsq":-37,"ssid":"xxxxxxxxxx"}},"timezone":8.0,"type":0,"user":{"avatar":"http:\/\/img5.petkit.cn\/uavatar\/2020\/5\/24\/xxxxxxxxxx","gender":1,"id":"xxxxxx","nick":"xxxxxx","official":0,"point":{"endGrowth":2000,"growth":1415,"honour":"LV5","icon":"http:\/\/img5.petkit.cn\/misc\/point\/s5","icon2":"http:\/\/img5.petkit.cn\/misc\/point\/l5","rank":5,"startGrowth":1000}}}}
            return this.post(format(this.urls.deviceDetail, this.deviceId), callback);
        }.bind(this);

        const parseDataFunction = function (data) {
            if (!data) {
                this.log('unable to retrieve device infomation from server.');
                this.deviceDetailInfo = {};
            } else {
                var deviceDetailInfo = JSON.parse(data);
                if (deviceDetailInfo && deviceDetailInfo['result'] &&
                    deviceDetailInfo['result']['state'] &&
                    deviceDetailInfo['result']['settings']) {
                    this.log('successfully retrieved device infomation from server.');
                    const status_info = {
                        'food' : deviceDetailInfo['result']['state']['food'] || 0,
                        'batteryPower' : deviceDetailInfo['result']['state']['batteryPower'] * (100 / max_batteryLevel) || 0,
                        'batteryStatus' : deviceDetailInfo['result']['state']['batteryStatus'] || 0,
                        'desiccantLeftDays' : deviceDetailInfo['result']['state']['desiccantLeftDays'] || 0,
                        'manualLock' : deviceDetailInfo['result']['settings']['manualLock'] || 0,
                        'name' : deviceDetailInfo['result']['name'] || 'PetkitFeederMini',
                        'sn' : deviceDetailInfo['result']['sn'] || 'PetkitFeederMini',
                        'firmware' : deviceDetailInfo['result']['firmware'] || '1.0.0'
                    };
                    this.deviceDetailInfo = status_info;
                } else {
                    this.log('unable to retrieve device infomation from server.');
                    this.deviceDetailInfo = {};
                }
            }
            // if desiccantLeftDays less than 5 day, auto reset it.
            if (this.config['autoResetDesiccant'] &&
                this.deviceDetailInfo &&
                this.deviceDetailInfo.desiccantLeftDays < 35) {
                this.hb_desiccantLeftDays_reset(null);
            }
            return this.deviceDetailInfo;
        }.bind(this);

        if (callback) {
            getDeviceDetailFromServer(function(data) {
                callback(parseDataFunction(data));
            }.bind(this));
        } else {
            return parseDataFunction(getDeviceDetailFromServer());
        }
    },

    // date：20200920
    getDailyFeedsInfoFromServer: function(date, callback = null) {
        return this.post(format(this.urls.dailyfeeds, this.deviceId, date), callback);
    },

    // date：20200920、time: 68400(-1 stand for current)、amount in app unit，1 for 5g, 10 is max(50g)
    saveDailyFeed: function(date, time, amount, callback = null) {
        return this.post(format(this.urls.saveDailyFeed, this.deviceId, date, time, amount * 5), callback);
    },

    // date：20200920、time: 68400(-1 stand for current)
    removeDailyFeed: function(date, time, callback = null) {
        return this.post(format(this.urls.removeDailyFeed, this.deviceId, date, time), callback);
    },

    // key see support_settings.
    updateDeviceSettings: function(key, value, callback = null) {
        var data = {};
        data[support_settings[key]] = value;
        return this.post(format(this.urls.updateSettings, this.deviceId, JSON.stringify(data)), callback);
    },

    updateHomebridgeStatus: function(status_info) {
        var status = status_info['food'] || false;
        this.log.debug('device food storage status is: ' + (status ? 'Ok' : 'Empty'));
        this.food_storage_service.setCharacteristic(Characteristic.OccupancyDetected, status);

        if (this.config['enable_desiccant']) {
            const desiccantLeftDays = status_info['desiccantLeftDays'] || 30;
            this.log.debug('desiccant days remain: ' + desiccantLeftDays + ' day(s)');
            status = (desiccantLeftDays < this.alertDesiccantLeftDays ? Characteristic.FilterChangeIndication.CHANGE_FILTER : Characteristic.FilterChangeIndication.FILTER_OK);
            this.desiccant_level_service.setCharacteristic(Characteristic.FilterChangeIndication, status);
        }
    },

    hb_dropMeal_set: function(value, callback) {
        if (value) {
            if (this.mealAmount) {
                this.log('drop food:' + this.mealAmount + 'meal(s)');
                const data = this.saveDailyFeed(dayjs(new Date()).format('YYYYMMDD'), -1, this.mealAmount);
                if (!data) {
                    this.log('failed to commuciate with server.');
                } else {
                    const result = this.praseSaveDailyFeedResult(data);
                    this.log('food drop result: ' + result ? 'success' : 'failed');
                }
            } else {
                this.log('drop food with zero amount, pass.');
            }
            setTimeout(function() {
                this.drop_meal_service.setCharacteristic(Characteristic.On, false);
            }.bind(this), 200);
        }
        callback(null);
        this.getDeviceDetailInfoFromServer(function(status_info){
            this.updateHomebridgeStatus(status_info);
        }.bind(this));
    },

    hb_desiccantIndicator_get: function(callback) {
        const callbackResult = function(fake_param) {
            const status = (this.deviceDetailInfo['desiccantLeftDays'] < this.alertDesiccantLeftDays ? 1 : 0);
            this.log.debug('desiccant status indicator status: ' + status);
            callback(null, status);
        }.bind(this);

        if (!this.enable_polling) {
            getDeviceDetailInfoFromServer(callbackResult);
        } else {
            callbackResult();
        }
    },

    hb_desiccantLeftDays_get: function(callback) {
        const callbackResult = function(fake_param) {
            const status = this.deviceDetailInfo['desiccantLeftDays'] || 30;
            this.log.debug('desiccant days remain: ' + status + ' day(s)');
            callback(null, status);
        }.bind(this);

        if (!this.enable_polling) {
            getDeviceDetailInfoFromServer(callbackResult);
        } else {
            callbackResult();
        }
    },

    // reset Desiccant Left Days 
    hb_desiccantLeftDays_reset: function(callback) {
        this.log.debug('hb_desiccantLeftDays_reset');
        return this.post(format(this.urls.resetDesiccant, this.deviceId), function(data){
            var jsonObj = JSON.parse(data);
            if (jsonObj['result']) {
                this.deviceDetailInfo['desiccantLeftDays'] = jsonObj['result'];
                this.log('reset desiccant left days success, left days reset to ' + jsonObj['result'] + ' days');
            } else {
                this.log.warn('reset desiccant left days failed.');
            }
            if (callback) {callback(null);}
        }.bind(this));
    },

    hb_foodStorageStatus_get: function(callback) {
        const callbackResult = function(fake_param) {
            const status = this.deviceDetailInfo['food'] || false;
            this.log.debug('device food storage status is: ' + (status ? 'Ok' : 'Empty'));
            callback(null, status);
        }.bind(this);
        
        if (!this.enable_polling) {
            getDeviceDetailInfoFromServer(callbackResult);
        } else {
            callbackResult();
        }
    },

    hb_manualLockStatus_set: function(value, callback) {
        const status = value ? 0 : 1;       // on for off, off for on, same behavior with Petkit app.
        this.updateDeviceSettings('manualLock', status, function(data) {
            callback(null);
            this.log('update manualLock status ' + (this.praseUpdateDeviceSettingsResult(data) ? 'success' : 'failed'));
            this.getDeviceDetailInfoFromServer(function(status_info){
                this.updateHomebridgeStatus(status_info);
            }.bind(this));
        }.bind(this));
    },

    hb_deviceBatteryLevel_get: function(callback) {
        const callbackResult = function(fake_param) {
            var status = this.deviceDetailInfo['batteryPower'];
            if (this.deviceDetailInfo['batteryStatus'] == 1) {
                status = 100;
            }
            this.log.debug('hb_deviceBatteryLevel_get:' + status);
            callback(null, status);
        }.bind(this);
        
        if (!this.enable_polling) {
            getDeviceDetailInfoFromServer(callbackResult);
        } else {
            callbackResult();
        }
    },

    hb_deviceChargingState_get: function(callback) {
        const callbackResult = function(fake_param) {
            var status = Characteristic.ChargingState.NOT_CHARGING;
            if (this.deviceDetailInfo['batteryStatus'] == 0) {
                status = Characteristic.StatusLowBattery.CHARGING;
            }
            this.log.debug('hb_deviceChargingState_get:' + status);
            callback(null, status);
        }.bind(this);
        
        if (!this.enable_polling) {
            getDeviceDetailInfoFromServer(callbackResult);
        } else {
            callbackResult();
        }
    },

    hb_deviceStatusLowBattery_get: function(callback) {
        const callbackResult = function(fake_param) {
            var status = Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
            if (this.deviceDetailInfo['batteryPower'] <= 50) {
                status = Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
            }
            this.log.debug('hb_deviceStatusLowBattery_get:' + status);
            callback(null, status);
        }.bind(this);
        
        if (!this.enable_polling) {
            getDeviceDetailInfoFromServer(callbackResult);
        } else {
            callbackResult();
        }
    },
}
