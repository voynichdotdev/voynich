/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/attest.json`.
 */
export type Attest = {
  "address": "9nt8ErJoyTnn79Hd79tEzViQGavTF2HLiJ4fjoN7U64g",
  "metadata": {
    "name": "attest",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "selfProgram",
          "address": "9nt8ErJoyTnn79Hd79tEzViQGavTF2HLiJ4fjoN7U64g"
        },
        {
          "name": "programData"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "devRoot",
          "type": "pubkey"
        },
        {
          "name": "maxReportAgeSlots",
          "type": "u64"
        },
        {
          "name": "recordLifetimeSlots",
          "type": "u64"
        }
      ]
    },
    {
      "name": "submitReport",
      "discriminator": [
        27,
        178,
        64,
        9,
        20,
        46,
        250,
        14
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "record",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  111,
                  114,
                  100
                ]
              },
              {
                "kind": "arg",
                "path": "signingKey"
              }
            ]
          }
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "version",
          "type": "u8"
        },
        {
          "name": "hardwareType",
          "type": "u8"
        },
        {
          "name": "signingKey",
          "type": "pubkey"
        },
        {
          "name": "measurement",
          "type": {
            "array": [
              "u8",
              48
            ]
          }
        },
        {
          "name": "recentSlot",
          "type": "u64"
        },
        {
          "name": "slotHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "signature",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        },
        {
          "name": "ed25519IxIndex",
          "type": "u16"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "attestConfig",
      "discriminator": [
        10,
        238,
        20,
        16,
        29,
        34,
        149,
        149
      ]
    },
    {
      "name": "attestationRecord",
      "discriminator": [
        33,
        137,
        13,
        193,
        39,
        232,
        216,
        63
      ]
    }
  ],
  "events": [
    {
      "name": "configInitialized",
      "discriminator": [
        181,
        49,
        200,
        156,
        19,
        167,
        178,
        91
      ]
    },
    {
      "name": "recordUpdated",
      "discriminator": [
        22,
        215,
        203,
        119,
        23,
        134,
        237,
        84
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Only the program upgrade authority can initialize attestation configuration."
    },
    {
      "code": 6001,
      "name": "invalidConfiguration",
      "msg": "The development root and slot limits must be explicitly configured."
    },
    {
      "code": 6002,
      "name": "unsupportedVersion",
      "msg": "This report layout version is not supported."
    },
    {
      "code": 6003,
      "name": "invalidHardwareType",
      "msg": "The hardware type must be dev, TDX or SEV-SNP."
    },
    {
      "code": 6004,
      "name": "invalidSigningKey",
      "msg": "The report must name a nonzero signing key."
    },
    {
      "code": 6005,
      "name": "invalidMeasurement",
      "msg": "The report must name a nonzero software measurement."
    },
    {
      "code": 6006,
      "name": "reportNotRecent",
      "msg": "The report's slot is in the future or older than the configured maximum age."
    },
    {
      "code": 6007,
      "name": "slotHashMismatch",
      "msg": "The report's slot hash is absent from the canonical SlotHashes sysvar."
    },
    {
      "code": 6008,
      "name": "reportReplay",
      "msg": "This report does not advance the record's root-signed slot."
    },
    {
      "code": 6009,
      "name": "invalidReportSignature",
      "msg": "The preceding Ed25519 instruction does not verify this report against the development root."
    },
    {
      "code": 6010,
      "name": "slotOverflow",
      "msg": "The configured record expiry overflows the slot counter."
    },
    {
      "code": 6011,
      "name": "invalidSlotHashes",
      "msg": "The SlotHashes sysvar data is invalid."
    }
  ],
  "types": [
    {
      "name": "attestConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "devRoot",
            "type": "pubkey"
          },
          {
            "name": "maxReportAgeSlots",
            "type": "u64"
          },
          {
            "name": "recordLifetimeSlots",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "attestationRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "layoutVersion",
            "type": "u8"
          },
          {
            "name": "signingKey",
            "type": "pubkey"
          },
          {
            "name": "hardwareType",
            "docs": [
              "0 = development stand-in, 1 = Intel TDX, 2 = AMD SEV-SNP."
            ],
            "type": "u8"
          },
          {
            "name": "measurement",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "recordedSlot",
            "type": "u64"
          },
          {
            "name": "expiresAtSlot",
            "type": "u64"
          },
          {
            "name": "reportSlot",
            "docs": [
              "Latest root-signed slot; a replay must never extend the record's lifetime."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "configInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "devRoot",
            "type": "pubkey"
          },
          {
            "name": "maxReportAgeSlots",
            "type": "u64"
          },
          {
            "name": "recordLifetimeSlots",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "recordUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "record",
            "type": "pubkey"
          },
          {
            "name": "signingKey",
            "type": "pubkey"
          },
          {
            "name": "hardwareType",
            "type": "u8"
          },
          {
            "name": "measurement",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "recordedSlot",
            "type": "u64"
          },
          {
            "name": "expiresAtSlot",
            "type": "u64"
          },
          {
            "name": "reportSlot",
            "type": "u64"
          }
        ]
      }
    }
  ]
};

// Generated by npm run build:programs. Anchor converts the runtime IDL names to camelCase.
export const IDL: Attest = {
  "address": "9nt8ErJoyTnn79Hd79tEzViQGavTF2HLiJ4fjoN7U64g",
  "metadata": {
    "name": "attest",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "self_program",
          "address": "9nt8ErJoyTnn79Hd79tEzViQGavTF2HLiJ4fjoN7U64g"
        },
        {
          "name": "program_data"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "dev_root",
          "type": "pubkey"
        },
        {
          "name": "max_report_age_slots",
          "type": "u64"
        },
        {
          "name": "record_lifetime_slots",
          "type": "u64"
        }
      ]
    },
    {
      "name": "submit_report",
      "discriminator": [
        27,
        178,
        64,
        9,
        20,
        46,
        250,
        14
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "record",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  111,
                  114,
                  100
                ]
              },
              {
                "kind": "arg",
                "path": "signing_key"
              }
            ]
          }
        },
        {
          "name": "slot_hashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "version",
          "type": "u8"
        },
        {
          "name": "hardware_type",
          "type": "u8"
        },
        {
          "name": "signing_key",
          "type": "pubkey"
        },
        {
          "name": "measurement",
          "type": {
            "array": [
              "u8",
              48
            ]
          }
        },
        {
          "name": "recent_slot",
          "type": "u64"
        },
        {
          "name": "slot_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "signature",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        },
        {
          "name": "ed25519_ix_index",
          "type": "u16"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "AttestConfig",
      "discriminator": [
        10,
        238,
        20,
        16,
        29,
        34,
        149,
        149
      ]
    },
    {
      "name": "AttestationRecord",
      "discriminator": [
        33,
        137,
        13,
        193,
        39,
        232,
        216,
        63
      ]
    }
  ],
  "events": [
    {
      "name": "ConfigInitialized",
      "discriminator": [
        181,
        49,
        200,
        156,
        19,
        167,
        178,
        91
      ]
    },
    {
      "name": "RecordUpdated",
      "discriminator": [
        22,
        215,
        203,
        119,
        23,
        134,
        237,
        84
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "Unauthorized",
      "msg": "Only the program upgrade authority can initialize attestation configuration."
    },
    {
      "code": 6001,
      "name": "InvalidConfiguration",
      "msg": "The development root and slot limits must be explicitly configured."
    },
    {
      "code": 6002,
      "name": "UnsupportedVersion",
      "msg": "This report layout version is not supported."
    },
    {
      "code": 6003,
      "name": "InvalidHardwareType",
      "msg": "The hardware type must be dev, TDX or SEV-SNP."
    },
    {
      "code": 6004,
      "name": "InvalidSigningKey",
      "msg": "The report must name a nonzero signing key."
    },
    {
      "code": 6005,
      "name": "InvalidMeasurement",
      "msg": "The report must name a nonzero software measurement."
    },
    {
      "code": 6006,
      "name": "ReportNotRecent",
      "msg": "The report's slot is in the future or older than the configured maximum age."
    },
    {
      "code": 6007,
      "name": "SlotHashMismatch",
      "msg": "The report's slot hash is absent from the canonical SlotHashes sysvar."
    },
    {
      "code": 6008,
      "name": "ReportReplay",
      "msg": "This report does not advance the record's root-signed slot."
    },
    {
      "code": 6009,
      "name": "InvalidReportSignature",
      "msg": "The preceding Ed25519 instruction does not verify this report against the development root."
    },
    {
      "code": 6010,
      "name": "SlotOverflow",
      "msg": "The configured record expiry overflows the slot counter."
    },
    {
      "code": 6011,
      "name": "InvalidSlotHashes",
      "msg": "The SlotHashes sysvar data is invalid."
    }
  ],
  "types": [
    {
      "name": "AttestConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "dev_root",
            "type": "pubkey"
          },
          {
            "name": "max_report_age_slots",
            "type": "u64"
          },
          {
            "name": "record_lifetime_slots",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "AttestationRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "layout_version",
            "type": "u8"
          },
          {
            "name": "signing_key",
            "type": "pubkey"
          },
          {
            "name": "hardware_type",
            "docs": [
              "0 = development stand-in, 1 = Intel TDX, 2 = AMD SEV-SNP."
            ],
            "type": "u8"
          },
          {
            "name": "measurement",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "recorded_slot",
            "type": "u64"
          },
          {
            "name": "expires_at_slot",
            "type": "u64"
          },
          {
            "name": "report_slot",
            "docs": [
              "Latest root-signed slot; a replay must never extend the record's lifetime."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "ConfigInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "dev_root",
            "type": "pubkey"
          },
          {
            "name": "max_report_age_slots",
            "type": "u64"
          },
          {
            "name": "record_lifetime_slots",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "RecordUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "record",
            "type": "pubkey"
          },
          {
            "name": "signing_key",
            "type": "pubkey"
          },
          {
            "name": "hardware_type",
            "type": "u8"
          },
          {
            "name": "measurement",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "recorded_slot",
            "type": "u64"
          },
          {
            "name": "expires_at_slot",
            "type": "u64"
          },
          {
            "name": "report_slot",
            "type": "u64"
          }
        ]
      }
    }
  ]
} as unknown as Attest
