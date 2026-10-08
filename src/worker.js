import slots from '../data/slots.json';
import release from '../data/release.json';
import { handle } from './api.js';

export default {
  async fetch(request, env) {
    return handle(request, env, { slots, release });
  },
};
