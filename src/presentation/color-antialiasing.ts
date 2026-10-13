import {
  SMAAEffect,
  SMAAPreset,
  EdgeDetectionMode,
  PredicationMode,
  EffectAttribute,
} from 'postprocessing';

export class ColorAntialiasing extends SMAAEffect {
  constructor() {
    super({
      preset: SMAAPreset.HIGH,
      edgeDetectionMode: EdgeDetectionMode.COLOR,
      predicationMode: PredicationMode.DISABLED,
    });
    // Color edges without depth predication need no composer depth copy.
    this.setAttributes(EffectAttribute.CONVOLUTION);
  }
}
