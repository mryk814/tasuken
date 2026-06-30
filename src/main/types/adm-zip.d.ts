declare module "adm-zip" {
  export default class AdmZip {
    addFile(name: string, content: Buffer): void;
    writeZip(filePath: string): void;
  }
}
