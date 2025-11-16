declare class OpenLocationCode {
  constructor(code: string);
  decode(): { latitudeCenter: number; longitudeCenter: number };
}
export { OpenLocationCode };
