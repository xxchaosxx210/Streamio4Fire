import type {Addon} from './types';

export function catalogueGenres(addons: Addon[]): string[] {
    return Array.from(new Set(addons.flatMap(a=>(a.manifest.catalogs || []).filter(c=>['movie','series'].includes(c.type)).flatMap(c=>c.extra?.find(e=>e.name==='genre')?.options || [])).filter(g=>typeof g==='string' && g.length>0 && !/^\d{4}(?:s|[-–]\d{4})?$/.test(g)))).sort();
}
export function catalogueRequests(addons: Addon[], query: string | null, genre: string) {
    return addons.flatMap((addon,addonIndex)=>(addon.manifest.catalogs || []).filter(c=>{
        if (!['movie','series'].includes(c.type)) return false;
        const extras=[...(c.extra || []).map(e=>e.name),...(c.extraSupported || [])];
        if (query!==null) return extras.includes('search');
        if ((c.extra || []).some(e=>e.isRequired && !(e.name==='genre' && genre))) return false;
        const options=c.extra?.find(e=>e.name==='genre')?.options;
        return !genre || (extras.includes('genre') && (!options?.length || options.includes(genre)));
    }).slice(0,query===null ? 2 : 4).map(catalogue=>({addon,addonIndex,catalogue}))).slice(0,query===null ? 8 : 16);
}
