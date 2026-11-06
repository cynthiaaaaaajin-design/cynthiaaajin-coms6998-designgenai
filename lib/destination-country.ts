/** Shared server-side resolver core. No Gemini; exact aliases never use substring matching. */
export type CountryResolution={destination:string;status:'resolved'|'unresolved';country_code:string|null;source:'reviewed_alias'|'google_places'|'none';reason?:string};
const key=(value:string)=>value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const aliases:Record<string,string>={
 'paris':'FR','paris, france':'FR','new york':'US','new york city':'US','nyc':'US','new york city, usa':'US','new york, ny, usa':'US',
 'shanghai':'CN','shanghai, china':'CN','tokyo':'JP','tokyo, japan':'JP','kyoto':'JP','kyoto, japan':'JP',
 'london':'GB','london, uk':'GB','rome':'IT','rome, italy':'IT','lisbon':'PT','lisbon, portugal':'PT',
 'toronto':'CA','toronto, canada':'CA','mexico city':'MX','mexico city, mexico':'MX','beijing':'CN','beijing, china':'CN',
 'hong kong':'HK','hong kong, china':'HK','macau':'MO','macao':'MO','taipei':'TW','taipei, taiwan':'TW',
};
const isoCountries='AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
const normalize=(value:string)=>key(value).normalize('NFKD').replace(/\p{M}/gu,'');
type Component={types?:string[];shortText?:string;longText?:string};
export async function resolveDestinationCountry(destination:string,apiKey?:string,fetcher:typeof fetch=fetch):Promise<CountryResolution>{
 const unresolved=(reason:string):CountryResolution=>({destination,status:'unresolved',country_code:null,source:'none',reason});
 if(!destination.trim()||destination.length>300)return unresolved('invalid_destination');
 if(/[;；→\n]|\s->\s/.test(destination))return unresolved('multi_country_or_multiple_stops');
 const known=aliases[key(destination)];
 if(known)return {destination,status:'resolved',country_code:known,source:'reviewed_alias'};
 // Require an explicit country qualifier for non-curated input. A free-text city name
 // alone is not enough evidence to select a regional workflow.
 const parts=destination.split(',').map(part=>part.trim());
 if(parts.length<2||!apiKey)return unresolved(parts.length<2?'ambiguous_or_unknown_destination':'country_resolver_unavailable');
 const countryNames=new Intl.DisplayNames(['en'],{type:'region'});
 const qualifier=normalize(parts.at(-1)!);
 const expectedCountry=isoCountries.find(code=>{
  const name=countryNames.of(code);return name!==code&&(normalize(name||'')===qualifier||normalize(code)===qualifier||({US:['usa','united states of america'],GB:['uk'],CN:['mainland china']} as Record<string,string[]>)[code]?.includes(qualifier));
 });
 if(!expectedCountry)return unresolved('unrecognized_country_qualifier');
 try{
  const response=await fetcher('https://places.googleapis.com/v1/places:searchText',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':apiKey,'X-Goog-FieldMask':'places.id,places.displayName,places.types,places.addressComponents'},body:JSON.stringify({textQuery:destination,pageSize:5,languageCode:'en'}),cache:'no-store',signal:AbortSignal.timeout(8000),redirect:'error'});
  if(!response.ok)return unresolved('country_resolver_error');
  const data=await response.json();
  const matches=(Array.isArray(data.places)?data.places:[]).filter((place:{displayName?:{text?:string};types?:string[];addressComponents?:Component[]})=>{
   const country=place.addressComponents?.find(c=>c.types?.includes('country'))?.shortText;
   return place.types?.some(t=>['locality','country','administrative_area_level_1'].includes(t))&&normalize(place.displayName?.text||'')===normalize(parts[0])&&country===expectedCountry;
  });
  if(matches.length!==1)return unresolved('ambiguous_or_unknown_destination');
  return {destination,status:'resolved',country_code:expectedCountry,source:'google_places'};
 }catch{return unresolved('country_resolver_unavailable');}
}
