// ------------------------------------------
// configreader
//
//  Reads a yaml configuration file and provides 
//  te methods to retrieve each parameter
// ------------------------------------------

import * as jsyaml from 'js-yaml';
import * as fs from 'fs';

export class ConfigReader{
  cfg: any;
  rootFolder: string;

  constructor(public configPath: string){
    try{
      this.rootFolder = __dirname.replace('/app/amazonmqrabbit/lib/util', '');
      this.cfg = jsyaml.safeLoad(fs.readFileSync(this.rootFolder + configPath, 'utf8'));
    }
    catch(e){
      throw new Error('Unable to load the configuration file: ' + this.rootFolder + configPath);
    }
  }

  get(param:string): string {
      return this.cfg[param];
  }
}
