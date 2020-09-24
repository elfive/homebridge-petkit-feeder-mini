'use strict';

let Service, Characteristic;

const request = require('request');
const request_sync = require('urllib-sync').request;
const format = require('string-format');
const dayjs = require('dayjs');
const pollingtoevent = require('polling-to-event');

const global_urls = Object.freeze({
    'cn': {
        'deviceState': 'http://api.petkit.cn/6/feedermini/devicestate?id={}',
        'deviceDetail': 'http://api.petkit.cn/6/feedermini/device_detail?id={}',
        'saveDailyFeed': 'http://api.petkit.cn/6/feedermini/save_dailyfeed?deviceId={}&day={}&time={}&amount={}',
        'removeDailyFeed': 'http://api.petkit.cn/6/feedermini/remove_dailyfeed?deviceId={}&day={}&id=d{}',
        'dailyfeeds': 'http://api.petkit.cn/6/feedermini/dailyfeeds?deviceId={}&days={}',
        'restoreDailyFeeds': 'http://api.petkit.cn/6/feedermini/restore_dailyfeed?deviceId={}&day={}&id=s{}',
        'disableDailyFeeds': 'http://api.petkit.cn/6/feedermini/remove_dailyfeed?deviceId={}&day={}&id=s{}',
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
        'owndevices': 'http://api.petktasia.com/latest/discovery/device_roster',
    }
});

const min_amount = 0;
const max_amount = 10;
const min_desiccantLeftDays = 0;
const max_desiccantLeftDays = 30;
const min_pollint_interval = 60;
const max_pollint_interval = 3600;

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

    this.log('begin to initialize petkit_feeder_mini_plugin');

    if (!this.config['location'] || !global_urls[this.config['location']]) {
        this.log.error('wrong value in config.json file: location');
        return;
    }
    this.urls = global_urls[this.config['location']];

    if (!this.config['headers']) {
        this.log.error('missing field in config.json file: headers');
        return;
    }
    this.headers = this.convertHeadersetFormat(this.config['headers']);
    switch(this.config['location']) {
        case 'cn':
            if (!this.headers['X-Session']) {
                this.log.error('missing field in config.json file: headers.X-Session');
                return;
            }
            break;
        case 'asia':
            if (!this.headers['X-Session']) {
                this.log.error('missing field in config.json file: headers.X-Session');
                return;
            }
            if (!this.headers['X-Api-Version']) {
                this.headers['X-Api-Version'] = '7.18.1';
                this.log('missing field in config.json file: headers.X-Api-Version, using "' + this.headers['X-Api-Version'] + '" instead.');
            }
            break;
        default:
        this.log.error('wrong value in config.json file: location');
        return;
    }

    // handle device connection info
    this.userAgent = this.config['userAgent'] || 'PetKit/7.19.1 (iPhone; iOS 14.0; Scale/3.00)';

    // make sure deviceId is correct or get the deviceId
    this.deviceId = this.config['deviceId'];
    const devices = this.praseGetDeviceResult(this.getDevices());
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

    this.log('Plugin Petkit Feeder Mini Loaded');
}

petkit_feeder_mini_plugin.prototype = {
    getServices: function() {
        var services = [];
        // meal drop service
        this.drop_meal_service = new Service.Switch('DropMeal');
        this.drop_meal_service.getCharacteristic(Characteristic.On)
            .on('get', this.getDropMealStatus.bind(this))
            .on('set', this.setDropMealStatus.bind(this));
        services.push(this.drop_meal_service);

        // meal amount setting service
        this.meal_amount_service = new Service.Fan('MealAmount');
        this.meal_amount_service.getCharacteristic(Characteristic.On)
            .on('get', function(callback) {
                callback(null, this.getMealAmount != 0);
            }.bind(this));
        this.meal_amount_service.getCharacteristic(Characteristic.RotationSpeed)
            .on('get', this.getMealAmount.bind(this))
            .on('set', this.setMealAmount.bind(this))
            .setProps({
                minValue: min_amount,
                maxValue: max_amount,
                minStep: 1
            });
        services.push(this.meal_amount_service);

        // food storage indicator service
        this.updateDeviceDetail();
        this.food_storage_service = new Service.OccupancySensor('FoodStorage');
        this.food_storage_service.getCharacteristic(Characteristic.OccupancyDetected)
            .on('get', this.getFoodStorageStatus.bind(this));
        var food_storage_status = this.deviceDetailInfo['food'] || 0;
        this.food_storage_service.setCharacteristic(Characteristic.OccupancyDetected, food_storage_status)
        services.push(this.food_storage_service);

        // desiccant left days service
        var desiccantLeftDays = this.deviceDetailInfo['desiccantLeftDays'] || max_desiccantLeftDays;
        this.desiccant_level_service = new Service.FilterMaintenance('DesiccantLevel');
        this.desiccant_level_service.getCharacteristic(Characteristic.FilterChangeIndication)
            .on('get', this.getDesiccantLeftDaysIndication.bind(this));
        this.desiccant_level_service.getCharacteristic(Characteristic.FilterLifeLevel)
            .on('get', this.getDesiccantLeftDays.bind(this))
            .setProps({
                minValue: min_desiccantLeftDays,
                maxValue: max_desiccantLeftDays,
                minStep: 1
            });
        this.desiccant_level_service.getCharacteristic(Characteristic.ResetFilterIndication)
            .on('set', this.resetDesiccantLeftDays.bind(this))
        services.push(this.desiccant_level_service);

        if (this.config['autoDeviceInfo']) {
            this.name = this.deviceDetailInfo['name'] || this.config['name'] || 'PetkitFeederMini';
            this.serialNumber = this.deviceDetailInfo['sn'] || this.config['sn'] || 'PetkitFeederMini';
            this.firmware = this.deviceDetailInfo['firmware'] || this.config['firmware'] || '1.0.0';
        } else {
            this.name = this.config['name'] || 'PetkitFeederMini';
            this.serialNumber = this.config['sn'] || 'PetkitFeederMini';
            this.firmware = this.config['firmware'] || '1.0.0';
        }

        this.battery_status_service = new Service.BatteryService('Battery');
        this.battery_status_service.getCharacteristic(Characteristic.BatteryLevel)
            .on('get', this.getDeviceBatteryLevel.bind(this));
        this.battery_status_service.getCharacteristic(Characteristic.ChargingState)
            .on('get', this.getDeviceChargingState.bind(this));
        this.battery_status_service.getCharacteristic(Characteristic.StatusLowBattery)
            .on('get', this.getDeviceStatusLowBattery.bind(this));
        services.push(this.battery_status_service);

        // divice information service
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
                this.updateDeviceDetail(function(status_info) {
                    done(null, status_info)
                }.bind(this));
            }.bind(this), polling_options);

            this.poolToEventEmitter.on('deviceStatusUpdatePoll', function(status_info) {
                this.updateHomebridgeStatus(status_info);
                this.log.debug('emit polling data: ' + JSON.stringify(status_info));
            }.bind(this));
        }

        return services;
    },

    // timeString: 08:20:00
    getDateString: function(timeString) {
        var date = dayjs(new Date());
        const currentTimeString = dayjs(new Date()).format('HH:mm:ss');
        if (getTimeFromString(currentTimeString) >= getTimeFromString(timeString)) {
            date.add(1, 'day');
        }
        return date.format('YYYYMMDD');
    },

    // timeString: 08:20:00
    getTimeFromString: function(timeString) {
        const matches = timeString.match(/(\d+)[^0-9](\d+)[^0-9](\d+)/);
        return parseInt(matches[1]) * 3600 + parseInt(matches[2]) * 60 + parseInt(matches[3]);
    },

    post: function(url, callback = null) {
        this.log.debug(url);
        const options = {
          url: url,
          method: 'POST',
          headers: this.headers
        };
        if (callback) {
            const that = this;
            request(options, function(error, response, data) {
                if (!error && response.statusCode == 200) {
                    callback(data);
                } else {
                    that.log.error(response.statusCode + ': ' + error);
                    callback(false);
                }
            });
        } else {
            var response = request_sync(options.url, options);
            if (response.status == 200) {
                return response.data.toString();
            }
            this.log.error(response.statusCode + ': ' + error);
            return false;
        }
    },

    praseSaveDailyFeedResult: function(jsonStr) {
        const jsonObj = JSON.parse(jsonStr);
        if (!jsonObj) {
            log('JSON.parse error with:' + jsonStr);
            return false;
        }

        if (jsonObj.hasOwnProperty('error')) {
            this.log(jsonObj.error.msg);
            return false;
        }

        if (!jsonObj.hasOwnProperty('result')) {
            return false;
        }

        if (jsonObj.result.isExecuted == 1) {
            return true;
        }

        return false;
    },

    praseRemoveDailyFeedResult: function(jsonStr) {
        const jsonObj = JSON.parse(jsonStr);
        if (!jsonObj) {
            log('JSON.parse error with:' + jsonStr);
            return false;
        }

        if (jsonObj.hasOwnProperty('error')) {
            this.log(jsonObj.error.msg);
            return false;
        }

        if (!jsonObj.hasOwnProperty('result')) {
            return false;
        }

        if (jsonObj.result == 'success') {
            return true;
        }

        return false;
    },

    praseDeviceStateResult: function(jsonStr) {
        const jsonObj = JSON.parse(jsonStr);
        if (!jsonObj) {
            this.log('JSON.parse error with:' + jsonStr);
            return false;
        }

        if (!jsonObj.hasOwnProperty('result')) {
            return false;
        }

        if (jsonObj.result.food) {}
    },

    praseGetDeviceResult: function(jsonStr) {
        const jsonObj = JSON.parse(jsonStr);
        if (!jsonObj) {
            this.log('JSON.parse error with:' + jsonStr);
            return false;
        }

        if (!jsonObj.hasOwnProperty('result')) {
            this.log('JSON.parse error with:' + jsonStr);
            return false;
        }

        if (!jsonObj.result.hasOwnProperty('devices')) {
            this.log('JSON.parse error with:' + jsonStr);
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

    // date：20200920、time: 68400
    confirmSaveFeedSuccess: function(date, time) {
        const jsonStr = this.getDailyFeedsInfo(date);
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
        const jsonStr = this.getDailyFeedsInfo(date);
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

    getDeviceState: function(callback = null) {
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

    getDeviceDetail: function(callback = null) {
        // {"result":{"createdAt":"2020-05-26T12:48:29.158Z","feed":{"deviceId":356367,"isExecuted":1,"isLock":1,"items":[{"amount":15,"id":"43200","name":"\u5348\u9910","petAmount":[{"amount":15,"petId":"770000"}],"time":43200}],"repeats":"1,2,3,4,5,6,7","suspended":0,"userId":"xxxxxx"},"firmware":"1.394","firmwareDetails":[{"module":"userbin","version":2003001}],"hardware":1,"id":356367,"locale":"Asia\/Shanghai","mac":"xxxxxxxxxxxx","name":"\u667A\u80FD\u5582\u98DF\u5668","relation":{"petIds":["xxxxxx"],"userId":"xxxxxx"},"secret":"xxxxxx","settings":{"desiccantNotify":0,"feedNotify":1,"foodNotify":1,"lightMode":0,"lightRange":[0,1440],"manualLock":0,"reBatteryNotify":1},"shareOpen":0,"signupAt":"2020-09-20T18:05:39.269Z","sn":"xxxx","state":{"batteryPower":4,"batteryStatus":0,"desiccantLeftDays":6,"errorPriority":0,"feeding":0,"food":1,"ota":0,"overall":1,"pim":1,"runtime":49677,"wifi":{"bssid":"xxxxxxxxxxxx","rsq":-37,"ssid":"xxxxxxxxxx"}},"timezone":8.0,"type":0,"user":{"avatar":"http:\/\/img5.petkit.cn\/uavatar\/2020\/5\/24\/xxxxxxxxxx","gender":1,"id":"xxxxxx","nick":"xxxxxx","official":0,"point":{"endGrowth":2000,"growth":1415,"honour":"LV5","icon":"http:\/\/img5.petkit.cn\/misc\/point\/s5","icon2":"http:\/\/img5.petkit.cn\/misc\/point\/l5","rank":5,"startGrowth":1000}}}}
        return this.post(format(this.urls.deviceDetail, this.deviceId), callback);
    },

    // date：20200920
    getDailyFeedsInfo: function(date, callback = null) {
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

    convertHeadersetFormat: function(config_headers) {
        var post_headers = {};
        config_headers.forEach(function(header, index) {
            post_headers[header.key] = header.value;
        });
        this.log.debug(post_headers);
        return post_headers;
    },

    getDevices: function(callback = null) {
        return this.post(this.urls.owndevices, callback);
    },

    updateDeviceDetail: function(callback = null) {
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
                        'batteryPower' : deviceDetailInfo['result']['state']['batteryPower'] || 0,
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
                    return this.deviceDetailInfo = {};
                }
            }
            return this.deviceDetailInfo;
        }.bind(this);

        if (callback) {
            this.getDeviceDetail(function(data) {
                callback(parseDataFunction(data));
            }.bind(this));
        } else {
            return parseDataFunction(this.getDeviceDetail());
        }
    },

    getDropMealStatus: function(callback) {
        const currentValue = 0;
        callback(null, currentValue);
    },

    setDropMealStatus: function(value, callback) {
        if (value) {
            if (this.mealAmount) {
                this.log('drop food:' + this.mealAmount + 'meal(s)');
                const that = this;
                const data = this.saveDailyFeed(dayjs(new Date()).format('YYYYMMDD'), -1, this.mealAmount);
                if (!data) {
                    callback('failed to commuciate with server.');
                } else {
                    const result = that.praseSaveDailyFeedResult(data);
                    that.log('food drop result: ' + result);
                }
            } else {
                this.log('drop food with zero amount, pass.');
            }
            setTimeout(function() {
                this.drop_meal_service.setCharacteristic(Characteristic.On, false);
            }.bind(this), 200);
        }
        callback(null);
    },

    getMealAmount: function(callback) {
        callback(null, this.mealAmount);
    },

    setMealAmount: function(value, callback) {
        this.mealAmount = value;
        this.log('set meal amount to ' + value);
        callback(null);
    },

    getDesiccantLeftDaysIndication: function(callback) {
        const desiccant_need_change = (this.status_info['desiccantLeftDays'] < this.alertDesiccantLeftDays ? 1 : 0);
        callback(null, desiccant_need_change);
    },

    getDesiccantLeftDays: function(callback) {
        const status = this.deviceDetailInfo['desiccantLeftDays'] || 30;
        this.log.debug('getDesiccantLeftDays: ' + status);
        callback(null, status);
    },

    // TODO reset Desiccant Left Days 
    resetDesiccantLeftDays: function(callback) {
        this.log.debug('resetDesiccantLeftDays');
        callback(null);
    },

    getFoodStorageStatus: function(callback) {
        const status = this.deviceDetailInfo['food'] || false;
        callback(null, status);
    },

    updateHomebridgeStatus: function(status_info) {
        var status = status_info['food'] || false;
        this.log('device food storage status is: ' + (status ? 'Ok' : 'Empty'));
        this.food_storage_service.setCharacteristic(Characteristic.OccupancyDetected, status);

        if (this.config['enable_desiccant']) {
            const desiccantLeftDays = status_info['desiccantLeftDays'] || 30;
            this.log('desiccant days remain: ' + desiccantLeftDays + ' day(s)');
            status = (desiccantLeftDays < this.alertDesiccantLeftDays ? Characteristic.FilterChangeIndication.CHANGE_FILTER : Characteristic.FilterChangeIndication.FILTER_OK);
            this.desiccant_level_service.setCharacteristic(Characteristic.FilterChangeIndication, status);
        }
    },

    // TODO
    getDeviceBatteryLevel: function(callback) {
        this.log.debug('getDeviceBatteryLevel');
        const status = 100;
        if (this.deviceDetailInfo['batteryStatus'] != 0) {
            status = this.deviceDetailInfo['batteryPower'];
        }
        callback(null, status);
    },

    // TODO
    getDeviceChargingState: function(callback) {
        this.log.debug('getDeviceChargingState');
        var status = Characteristic.ChargingState.CHARGING;
        if (this.deviceDetailInfo['batteryStatus'] != 0) {
            status = Characteristic.StatusLowBattery.NOT_CHARGING;
        }
        callback(null, Characteristic.ChargingState.CHARGING);
    },

    // TODO
    getDeviceStatusLowBattery: function(callback) {
        this.log.debug('getDeviceStatusLowBattery');
        var status = Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
        if (this.deviceDetailInfo['batteryStatus'] == 0) {
            status = Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
        }
        callback(null, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
    },
}
