'use strict';

let Service, Characteristic;

const request = require('request');
const request_sync = require('urllib-sync').request;
const format = require('string-format');
const dayjs = require('dayjs');

const global_urls = Object.freeze({
    'cn': {
        'deviceState': 'http://api.petkit.cn/6/feedermini/devicestate?id={}',
        'deviceDetail': 'http://api.petkit.cn/6/feedermini/device_detail?id={}',
        'saveDailyFeed': 'http://api.petkit.cn/6/feedermini/save_dailyfeed?deviceId={}&day={}&time={}&amount={}',
        'removeDailyFeed': 'http://api.petkit.cn/6/feedermini/remove_dailyfeed?deviceId={}&day={}&id=d{}',
        'dailyfeeds': 'http://api.petkit.cn/6/feedermini/dailyfeeds?deviceId={}&days={}',
        'restoreDailyFeeds': 'http://api.petkit.cn/6/feedermini/restore_dailyfeed?deviceId={}&day={}&id=s{}',
        'disableDailyFeeds': 'http://api.petkit.cn/6/feedermini/remove_dailyfeed?deviceId={}&day={}&id=s{}',
    },
    'asia':{
        'deviceState': 'http://api.petktasia.com/latest/feedermini/devicestate?id={}',
        'deviceDetail': 'http://api.petktasia.com/latest/feedermini/device_detail?id={}',
        'saveDailyFeed': 'http://api.petktasia.com/latest/feedermini/save_dailyfeed?deviceId={}&day={}&time={}&amount={}',
        'removeDailyFeed': 'http://api.petktasia.com/latest/feedermini/remove_dailyfeed?deviceId={}&day={}&id=d{}',
        'dailyfeeds': 'http://api.petktasia.com/latest/feedermini/dailyfeeds?deviceId={}&days={}',
        'restoreDailyFeeds': 'http://api.petktasia.com/latest/feedermini/restore_dailyfeed?deviceId={}&day={}&id=s{}',
        'disableDailyFeeds': 'http://api.petktasia.com/latest/feedermini/remove_dailyfeed?deviceId={}&day={}&id=s{}',
    }
});

const min_amount = 1;
const max_amount = 10;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory('homebridge-petkit-feeder-mini', 'petkit_feeder_mini', petkit_feeder_mini_plugin);
}

function petkit_feeder_mini_plugin(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.service = [];

    this.log('begin to initialize petkit_feeder_mini_plugin');

    // handle device settings, setting below should captured via 
    if (!this.config['deviceId']) {
        this.log.error('missing field in config.json file: deviceId');
        return;
    }

    if (!this.config['location'] || !global_urls[this.config['location']]) {
        this.log.error('wrong value in config.json file: location');
        return;
    }
    this.urls = global_urls[this.config['location']];

    if (!this.config['headers']) {
        this.log.error('missing field in config.json file: headers');
        return;
    }
    this.headers = this.config['headers'];
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

    // handle feed settings
    // meal, same as petkit app unit. one share stands for 5g or 1/20 cup, ten meal most;
    this.fix_amount = this.config['fix_amount'] || 3;
    this.variable_amount = 0;

    // handle device connection info
    this.deviceId = this.config['deviceId'];
    this.userAgent = this.config['userAgent'] || 'PetKit/7.19.1 (iPhone; iOS 14.0; Scale/3.00)';

    this.manufacturer = this.config['manufacturer'] || 'Petkit';
    this.model = this.config['model'] || 'Petkit feeder mini';

    var deviceDetail = {};
    if (this.config['autoDeviceInfo']) {
        this.deviceDetailInfo = JSON.parse(this.getDeviceDetail());
        if (this.deviceDetailInfo && this.deviceDetailInfo['result']) {
            deviceDetail = this.deviceDetailInfo['result'];
            this.log('retrieve device infomation from server.');
        } else {
            this.log('unable to retrieve device infomation from server.');
        }
    }
    this.timezone = this.config['timezone'] || deviceDetail['timezone'] || 8.0;
    this.name = this.config['name'] || deviceDetail['name'] || 'PetkitFeederMini';
    this.serialNumber = this.config['sn'] || deviceDetail['sn'] || 'PetkitFeederMini';
    this.firmware = this.config['firmware'] || deviceDetail['firmware'] || '1.0.0';

    this.log('Plugin Petkit Feeder Mini Loaded');

    this.fix_amount_service = new Service.Switch('ExtraMeal-' + this.fix_amount);
    this.fix_amount_service.getCharacteristic(Characteristic.On)
        .on('get', this.getFixAmountStatus.bind(this))
        .on('set', this.setFixAmountStatus.bind(this));
    this.service.push(this.fix_amount_service);

    if (this.config['more_control']) {
        this.variable_amount_service = new Service.Fan('ExtraMeal');
            this.variable_amount_service.getCharacteristic(Characteristic.On)
            .on('get', this.getVariableAmountStatus.bind(this))
            .on('set', this.setVariableAmountStatus.bind(this));
        this.variable_amount_service.getCharacteristic(Characteristic.RotationSpeed)
            .on('get', this.getVariableAmount.bind(this))
            .on('set', this.setVariableAmount.bind(this));
        this.service.push(this.variable_amount_service);
    }

    this.info_service = new Service.AccessoryInformation();
    this.info_service
        .setCharacteristic(Characteristic.Identify, this.deviceId)
        .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
        .setCharacteristic(Characteristic.Model, this.model)
        .setCharacteristic(Characteristic.SerialNumber, this.serialNumber)
        // infomation below changed from petkit app require a homebridge reboot to take effect.
        .setCharacteristic(Characteristic.Name, this.name)
        .setCharacteristic(Characteristic.FirmwareRevision, this.firmware);
    this.service.push(this.info_service);
}

petkit_feeder_mini_plugin.prototype = {
    getServices: function() {
        return this.service;
    },

    realTimeExtraMealService_set: function(value, callback) {
        this.log('Triggered SET On:', value);
        saveDailyFeed();
        callback(null);
    },

    planedExtraMealService_get: function(callback) {
        const currentValue = 0;
        callback(null, currentValue);
    },

    planedExtraMealService_set: function(value, callback) {
        this.log('Triggered SET On:', value);
        callback(null);
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
        this.log(url);
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

    getFixAmountStatus: function(callback) {
        const currentValue = 0;
        callback(null, currentValue);
    },

    setFixAmountStatus: function(value, callback) {
        const fix_amount = this.fix_amount;
        const that = this;
        // date, time, amount, callback
        this.saveDailyFeed(dayjs(new Date()).format('YYYYMMDD'), -1, fix_amount, function(data) {
            if (!data) {
                callback('failed to commuciate with server.');
            } else {
                const result = that.praseSaveDailyFeedResult(data);
                if (!result) {
                    callback(result);
                } else {
                    callback(null);
                }
            }
        });
    },

    getVariableAmountStatus: function(callback) {
        const currentValue = 0;
        callback(null, currentValue);
    },

    setVariableAmountStatus: function(value, callback) {
        this.variable_amount = this.convertFanSpeedToAmount(value);
        const that = this;
        // date, time, amount, callback
        this.saveDailyFeed(dayjs(new Date()).format('YYYYMMDD'), -1, this.variable_amount, function(data) {
            if (!data) {
                callback('failed to commuciate with server.');
            } else {
                const result = that.praseSaveDailyFeedResult(data);
                if (!result) {
                    callback(result);
                } else {
                    callback(null);
                }
            }
        });
    },

    getVariableAmount: function(callback) {
        const currentValue = 0;
        callback(null, currentValue);
    },

    setVariableAmount: function(value, callback) {
        this.variable_amount = this.convertFanSpeedToAmount(value);
        const that = this;
        // date, time, amount, callback
        this.saveDailyFeed(dayjs(new Date()).format('YYYYMMDD'), -1, this.variable_amount, function(data) {
            if (!data) {
                callback('failed to commuciate with server.');
            } else {
                const result = that.praseSaveDailyFeedResult(data);
                if (!result) {
                    callback(result);
                } else {
                    callback(null);
                }
            }
        });
    },

    convertFanSpeedToAmount: function(fanSpeed) {
        var amount = 0;
        if (fanSpeed == 100) {
            amount = 10;
        } else {
            amount = Math.floor(fanSpeed / (min_amount + max_amount - 1)) + min_amount;
        }
        this.log('convert fanSpeed: ' + fanSpeed + ' to amount: ' + amount);
        return amount;
    },

    convertAmountToFanSpeed: function(amount) {
        var fanSpeed = 0;
        if (amount == min_amount) {
            fanSpeed = 0;
        } else {
            fanSpeed = (100 / (min_amount + max_amount - 1)) * amount;
        }
        this.log('convert amount: ' + amount + ' to fanSpeed: ' + fanSpeed);
        return fanSpeed;
    },
}
