/**
 * Lich's licence, verbatim, as the one place this repository records it.
 *
 * BSD-3-Clause condition 2 is the reason this exists: a binary redistribution
 * must reproduce the copyright notice, the conditions and the disclaimer "in
 * the documentation and/or other materials provided with the distribution".
 * The app fetches and ships Ruby4Lich5, so the app itself has to carry the
 * text, not only point at it.
 *
 * Two consumers read this module and neither keeps its own copy:
 *   - `src/components/layout/SettingsSheet.tsx` renders it (E9);
 *   - `tools/build-third-party.mjs` derives THIRD_PARTY.md's Lich section
 *     from it, and checks it against a real install when one is present.
 *
 * The text below was read from `C:/Ruby4Lich5/Lich5/LICENSE` on 5 Sep 2026,
 * not copied from a summary. `docs/ENGINE.md` says verify rather than trust,
 * and `tools/build-third-party.mjs` keeps doing so on every run: it re-reads
 * a local install and fails when this file and that file disagree. On a
 * machine with no Lich it says NOT CHECKED rather than passing quietly.
 */

export const LICH_LICENSE = {
  /** SPDX identifier, as it appears in THIRD_PARTY.md's tables. */
  spdx: 'BSD-3-Clause',

  /** The licence's own title line, used as the positive control on a read. */
  title: 'BSD 3-Clause License',

  /**
   * Condition 2 requires these to be reproduced. Order is the licence's own.
   */
  holders: [
    'Copyright (c) 2005-2006, Murray Miron',
    'Copyright (c) 2006-2020, Matt Lowe (Tillmen)',
    'Copyright (c) 2021-present, Elanthia Online',
  ],

  /** The permission grant, verbatim. */
  grant:
    'Redistribution and use in source and binary forms, with or without ' +
    'modification, are permitted provided that the following conditions are met:',

  /** The three conditions, verbatim, in the licence's order. */
  conditions: [
    'Redistributions of source code must retain the above copyright notice, ' +
      'this list of conditions and the following disclaimer.',
    'Redistributions in binary form must reproduce the above copyright ' +
      'notice, this list of conditions and the following disclaimer in the ' +
      'documentation and/or other materials provided with the distribution.',
    'Neither the name of the copyright holder nor the names of its ' +
      'contributors may be used to endorse or promote products derived from ' +
      'this software without specific prior written permission.',
  ],

  /** The warranty disclaimer, verbatim. Shouting is the licence's, not ours. */
  disclaimer:
    'THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" ' +
    'AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE ' +
    'IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE ' +
    'DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE ' +
    'FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL ' +
    'DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR ' +
    'SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER ' +
    'CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, ' +
    'OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE ' +
    'OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.',

  /** Where the upstream project publishes it. */
  url: 'https://github.com/elanthia-online/lich-5',
} as const
