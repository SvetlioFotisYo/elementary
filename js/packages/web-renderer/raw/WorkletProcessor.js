const EventTypes = {
  CREATE_NODE: 0,
  DELETE_NODE: 1,
  APPEND_CHILD: 2,
  SET_PROPERTY: 3,
  ACTIVATE_ROOTS: 4,
  COMMIT_UPDATES: 5,
  UPDATE_RESOURCE_MAP: 6,
  RESET: 7,
};


class ElementaryAudioWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);

    const numInputChannels = options.numberOfInputs;
    const numOutputChannels = options.outputChannelCount.reduce((acc, next) => acc + next, 0);

    this._module = Module();
    this._native = new this._module.ElementaryAudioProcessor(numInputChannels, numOutputChannels);

    // Apparently the `sampleRate` variable is just a globally defined
    // variable in the AudioWorklet scope. Randomly choosing a block size
    // larger than 128, which I think is what the browser usually uses
    this._native.prepare(sampleRate, 512);

    const hasProcOpts = options.hasOwnProperty('processorOptions') &&
      typeof options.processorOptions === 'object' &&
      options.processorOptions !== null;

    if (hasProcOpts) {
      const {virtualFileSystem, ...other} = options.processorOptions;

      const validVFS = typeof virtualFileSystem === 'object' &&
        virtualFileSystem !== null &&
        Object.keys(virtualFileSystem).length > 0;

      if (validVFS) {
        this._native.postMessageBatch([
          [EventTypes.UPDATE_RESOURCE_MAP, virtualFileSystem],
          [EventTypes.COMMIT_UPDATES],
        ], (type, message) => {
          // This callback will only be called in the event of an error, we just relay
          // it to the renderer frontend.
          this.port.postMessage([type, msg]);
        });
      }
    }

    this.port.onmessage = (e) => {
      switch (e.data.type) {
        case 'renderInstructions':
          this._native.postMessageBatch(e.data.batch, (type, msg) => {
            // This callback will only be called in the event of an error, we just relay
            // it to the renderer frontend.
            this.port.postMessage([type, msg]);
          });

          break;
        case 'processQueuedEvents':
          this._native.processQueuedEvents((evtBatch) => {
            evtBatch.forEach((e) => {
              this.port.postMessage(e);
            });
          });

          break;
        case 'updateSharedResourceMap':
          for (let [key, val] of Object.entries(e.data.resources)) {
            this._native.updateSharedResourceMap(key, val, (message) => {
              this.port.postMessage(['error', message]);
            });
          }

          break;
        case 'reset':
          this._native.reset();
          break;
        default:
          break;
      }
    };

    this.port.postMessage(['load', {
      sampleRate,
      blockSize: 128,
      numInputChannels,
      numOutputChannels,
    }]);
  }

  process (inputs, outputs, parameters) {
    if (inputs.length > 0) {
      let m = 0;

      // For each input
      for (let i = 0; i < inputs.length; ++i) {
        // For each channel on this input
        for (let j = 0; j < inputs[i].length; ++j) {
          const internalInputData = this._native.getInputBufferData(m++);

          // For each sample on this input channel
          for (let k = 0; k < inputs[i][j].length; ++k) {
            internalInputData[k] = inputs[i][j][k];
          }
        }
      }
    }

    const numSamples = (outputs.length > 0 && outputs[0].length > 0)
      ? outputs[0][0].length
      : 0;

    this._native.process(numSamples);

    if (outputs.length > 0) {
      let m = 0;

      // For each output
      for (let i = 0; i < outputs.length; ++i) {
        // For each channel on this output
        for (let j = 0; j < outputs[i].length; ++j) {
          const internalOutputData = this._native.getOutputBufferData(m++);

          // For each sample on this input channel
          for (let k = 0; k < outputs[i][j].length; ++k) {
            outputs[i][j][k] = internalOutputData[k];
          }
        }
      }
    }

    // Tells the browser to keep this node alive and continue calling process
    return true;
  }
}

registerProcessor('ElementaryAudioWorkletProcessor', ElementaryAudioWorkletProcessor);
