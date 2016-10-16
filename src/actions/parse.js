/**
 *  Copyright (c) 2016, Michael R Hanney. All rights reserved.
 *
 *  No affiliation with Zwift LLC whatsoever. Use at your own risk.
 *
 *  This source code is licensed under the MIT-style license found in the
 *  LICENSE file in the root directory of this source tree.
 */

var request = require('qwest')
var _ = require('underscore')
var moment = require('moment')
var uuid = require('node-uuid')

import * as Parser from '../parser/index.js'

const delay = 250

export const SET_SYSTEM_DATA = 'SET_SYSTEM_DATA'
export const SET_ACTIVITY_DATA = 'SET_ACTIVITY_DATA'
export const SET_GRAPHICS_DATA = 'SET_GRAPHICS_DATA'
export const SET_ANT_DATA = 'SET_ANT_DATA'
export const SET_NETWORK_DATA = 'SET_NETWORK_DATA'

export const FILE_LOADED = 'FILE_LOADED'
export const FILE_LOADING = 'FILE_LOADING'
export const RESET = 'RESET'
export const UPDATE_PROGRESS = 'UPDATE_PROGRESS'

function parseFileContents(log, isDemo = false) {

  return dispatch => {

    // this is only to update the ui
    // to let the user know the file is being read
    // (hide the dropzone)
    dispatch(fileLoading())

    // delayed so that the state can update the loading message
    setTimeout(() => {

      const head = Parser.head(log)

      // we parse the head of the log to get all of the system properties, and the constants for the graphics properties
      const systemData = parseHead(head)

      // turn all times into continuous epoch unix timestamps, and normalize all the new lines
      const normalizedLog = Parser.epochify(Parser.normalize(log));

      const activityData = parseActivity(normalizedLog)

      const graphicsData = parseGraphics(normalizedLog, activityData.duration)

      // now remove all the fps lines to make the next extraction quicker
      const logWithoutFpsLines = Parser.stripFpsLines(normalizedLog)

      const antData = parseAnt(logWithoutFpsLines, activityData.timeAxisTimeSeries)

      // now remove all the ANT+ lines to make the next extraction quicker
      const logWithoutFpsAntLines = Parser.normalize(Parser.stripAntLines(logWithoutFpsLines))

      const networkData = parseNetwork(logWithoutFpsAntLines, activityData.timeAxisTimeSeries)

      dispatch({
        type: SET_SYSTEM_DATA,
        data: {
          ...systemData
        }
      })

      dispatch({
        type: SET_ACTIVITY_DATA,
        data: {
          ...activityData
        }
      })

      // notice how we merge the graphics and system data together here,
      // the data.systemData spread operator will include CPU details too
      dispatch({
        type: SET_GRAPHICS_DATA,
        data: {
          ...graphicsData,
          specs: {
            ...systemData
          }
        }
      })

      dispatch({
        type: SET_ANT_DATA,
        data: {
          ...antData
        }
      })

      dispatch({
        type: SET_NETWORK_DATA,
        data: {
          ...networkData
        }
      })

      dispatch(fileLoaded())

      if (!isDemo && graphicsData.fpsData.count) {

        let profileId = '0'

        switch (systemData.profile) {

          case ('medium'):
            {
              profileId = '1'
              break;
            }
          case ('high'):
            {
              profileId = '2'
              break;
            }
          case ('ultra'):
            {
              profileId = '3'
              break;
            }
        }

        const summaryData = {
          'logId': uuid.v4(),
          'timestamp': activityData.startTimestamp,
          'duration': activityData.duration + '',
          'specs': {
            'resolution': systemData.resolution,
            'profileId': profileId + '',
            'profile': systemData.profile,
            'minFps': Math.round(graphicsData.fpsData.min()) + '',
            'maxFps': Math.round(graphicsData.fpsData.max()) + '',
            'avgFps': Math.round(graphicsData.fpsData.avg()) + '',
            'stdev': Math.round(graphicsData.fpsData.stdev()) + '',
            'samples': graphicsData.fpsSamples + '',
            'platform': systemData.platform,
            'cpuVendor': systemData.cpuVendor,
            'cpuDetails': systemData.cpuDetails,
            'ram': systemData.ram,
            'gpuVendor': systemData.gpuVendor,
            'gpuDetails': systemData.gpuDetails,
            'shadowres': systemData.shadowres,
            'openglMajor': systemData.openglMajor
          }
        }

        dispatch(uploadResults(summaryData))

      }

    }, delay)
  }
}

export function loadDemo() {

  return dispatch => {
    request.get('demolog.txt', null, {
      cache: true,
      dataType: 'json'
    }).then((xhr, response) => {
      dispatch(parseFileContents(response, true))
    })
  }
}

export function readFile(log) {

  return dispatch => {

    const reader = new FileReader()

    reader.onload = () => {
      dispatch(parseFileContents(reader.result, false))
    }

    reader.readAsBinaryString(log);
  }
}

function parseHead(head) {
  // platform detection depends on line endings,
  // so do it before cleaning the line endings
  const platform = Parser.platform(head)

  const normalizedHead = Parser.normalize(head)

  const cpuVendor = Parser.cpuVendor(normalizedHead)

  const cpuDetails = Parser.cpuDetails(normalizedHead)

  const ram = Parser.ram(normalizedHead)

  const gpuVendor = Parser.gpuVendor(normalizedHead)

  const gpuDetails = Parser.gpuDetails(normalizedHead)

  const profile = Parser.profile(normalizedHead);

  const resolution = Parser.resolution(normalizedHead);

  const shadowres = Parser.shadowres(normalizedHead);

  const openglMajor = Parser.openglMajor(normalizedHead);

  const openglMinor = Parser.openglMinor(normalizedHead);

  return Object.freeze({
    platform,
    cpuVendor,
    cpuDetails,
    ram,
    gpuVendor,
    gpuDetails,
    profile,
    resolution,
    shadowres,
    openglMajor,
    openglMinor
  })
}

function parseActivity(log) {

  const startDate = Parser.startDate(log)

  const startTime = Parser.startTime(log)

  const startDateTime = Parser.startDateTime(log)

  const duration = Parser.duration(log)

  const durationFormatted = Parser.toHoursMinutesSeconds(duration)

  const humanizedDuration = Parser.humanizeDuration(durationFormatted)

  const startTimestamp = moment(startDateTime, 'HH:mm:ss YYYY-MM-DD').unix()

  const timerange = Parser.timerange(startTimestamp, duration)

  const endTimestamp = timerange.endMilliseconds / 1000

  const timeAxisTimeSeries = Parser.timeAxis(timerange.startMilliseconds, timerange.endMilliseconds)

  // using Object.freeze to ensure these properties cannot accidentally be modified
  return Object.freeze({
    startDate,
    startTime,
    startDateTime,
    startTimestamp,
    endTimestamp,
    duration,
    durationFormatted,
    humanizedDuration,
    timeAxisTimeSeries
  })
}

function parseGraphics(log, duration = 0) {

  // default sampleSize is 15 second average buckets

  let sampleSize = 15

  // if greater than 2 hours, increase the sampleSize to 30 second average buckets
  if (duration > (2 * 60 * 60)) {
    sampleSize = 30;
  }

  // if greater than 4 hours, increase the sampleSize to 60 second average buckets
  if (duration > (4 * 60 * 60)) {
    sampleSize = 60;
  }

  sampleSize = sampleSize + 's'

  const fpsLines = Parser.mapFpsLines(log)

  const fpsSamples = (fpsLines && fpsLines.length) || 0

  const fpsData = Parser.reduceFps(fpsLines, sampleSize)

  return {
    fpsSamples,
    fpsData
  }

}

function parseAnt(log, timeAxisTimeSeries) {
  const antData = Parser.antData(log, timeAxisTimeSeries)
  return antData
}

function parseNetwork(log, timeAxisTimeSeries) {

  const networkLines = Parser.mapNetworkLines(log)

  const reconnects = Parser.mapNetworkReconnects(networkLines, timeAxisTimeSeries)

  const errors = Parser.mapNetworkErrors(networkLines, timeAxisTimeSeries)

  const phoneConnectionAttempts = Parser.mapNetworkPhoneConnectionAttempts(networkLines, timeAxisTimeSeries)

  return {
    reconnects,
    errors,
    phoneConnectionAttempts
  }
}

export function uploadResults(data) {

  return function(dispatch) {

    return request.post('https://pmqw53ywng.execute-api.us-west-2.amazonaws.com/dev/logs', data, {
      cache: false,
      dataType: 'json'
    }).then((xhr, json) => {
      //console.log('Success uploading results')
      //console.log(xhr)
      //console.log(json)
    }).catch(function(e, xhr, response) {
      console.log('Error uploading results')
      console.log(e)
      console.log(xhr)
      console.log(response)
    });
  }
}

function fileLoading() {
  return {
    type: FILE_LOADING
  }
}

function fileLoaded() {
  return {
    type: FILE_LOADED
  }
}

export function reset() {
  return {
    type: RESET
  }
}
