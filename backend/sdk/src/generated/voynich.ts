/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/voynich.json`.
 */
export type Voynich = {
  "address": "65H3C7T6C2DmbkR9ssBBmNtqpybWcYwotkkETL4E7RSS",
  "metadata": {
    "name": "voynich",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "attachWeights",
      "discriminator": [
        18,
        240,
        93,
        65,
        255,
        88,
        200,
        26
      ],
      "accounts": [
        {
          "name": "uploadKey",
          "signer": true
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
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
      "args": []
    },
    {
      "name": "createModel",
      "discriminator": [
        212,
        233,
        41,
        219,
        130,
        212,
        212,
        229
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "uploadKey",
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
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "arg",
                "path": "args.name"
              }
            ]
          }
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
          "name": "args",
          "type": {
            "defined": {
              "name": "createModelArgs"
            }
          }
        }
      ]
    },
    {
      "name": "deprecateMeasurement",
      "discriminator": [
        168,
        198,
        99,
        230,
        225,
        216,
        225,
        88
      ],
      "accounts": [
        {
          "name": "authority",
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
          "name": "measurement",
          "writable": true
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
      "args": []
    },
    {
      "name": "grantByEnclave",
      "discriminator": [
        224,
        119,
        4,
        9,
        211,
        140,
        40,
        127
      ],
      "accounts": [
        {
          "name": "signingKey",
          "signer": true,
          "relations": [
            "sourceEnclave"
          ]
        },
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
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "sourceEnclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "signingKey"
              }
            ]
          }
        },
        {
          "name": "sourceGrant",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "sourceEnclave"
              }
            ]
          }
        },
        {
          "name": "sourceAttestationRecord"
        },
        {
          "name": "targetEnclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "target_enclave.signing_key",
                "account": "enclave"
              }
            ]
          }
        },
        {
          "name": "targetAttestationRecord"
        },
        {
          "name": "grant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "targetEnclave"
              }
            ]
          }
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
          "name": "wrappedKey",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "grantByOwner",
      "discriminator": [
        201,
        72,
        8,
        221,
        34,
        178,
        68,
        207
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
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
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "targetEnclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "target_enclave.signing_key",
                "account": "enclave"
              }
            ]
          }
        },
        {
          "name": "targetAttestationRecord"
        },
        {
          "name": "grant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "targetEnclave"
              }
            ]
          }
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
          "name": "wrappedKey",
          "type": "bytes"
        }
      ]
    },
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
          "name": "programAccount",
          "address": "65H3C7T6C2DmbkR9ssBBmNtqpybWcYwotkkETL4E7RSS"
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
          "name": "args",
          "type": {
            "defined": {
              "name": "configArgs"
            }
          }
        }
      ]
    },
    {
      "name": "migrateConfig",
      "discriminator": [
        92,
        131,
        58,
        105,
        210,
        154,
        224,
        193
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true
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
          "name": "maxOpenAnswerBytes",
          "type": "u16"
        }
      ]
    },
    {
      "name": "migrateModel",
      "discriminator": [
        90,
        10,
        167,
        137,
        249,
        28,
        226,
        1
      ],
      "accounts": [
        {
          "name": "authority",
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
          "name": "model",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "openCall",
      "discriminator": [
        153,
        26,
        89,
        45,
        252,
        243,
        183,
        62
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "caller",
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
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          },
          "relations": [
            "grant"
          ]
        },
        {
          "name": "enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "enclave"
              }
            ]
          },
          "relations": [
            "grant"
          ]
        },
        {
          "name": "attestationRecord"
        },
        {
          "name": "grant",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "enclave"
              }
            ]
          }
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "caller"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "callerTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "escrowTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
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
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "inputHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "answerMode",
          "type": {
            "defined": {
              "name": "answerMode"
            }
          }
        },
        {
          "name": "callback",
          "type": {
            "option": {
              "defined": {
                "name": "callbackSpec"
              }
            }
          }
        }
      ]
    },
    {
      "name": "openMeteredCall",
      "discriminator": [
        92,
        224,
        42,
        248,
        250,
        113,
        170,
        2
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "caller",
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
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          },
          "relations": [
            "grant"
          ]
        },
        {
          "name": "enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "enclave"
              }
            ]
          },
          "relations": [
            "grant"
          ]
        },
        {
          "name": "attestationRecord"
        },
        {
          "name": "grant",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "enclave"
              }
            ]
          }
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "caller"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "callerTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "escrowTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
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
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "inputHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "answerMode",
          "type": {
            "defined": {
              "name": "answerMode"
            }
          }
        },
        {
          "name": "callback",
          "type": {
            "option": {
              "defined": {
                "name": "callbackSpec"
              }
            }
          }
        },
        {
          "name": "ceiling",
          "type": "u64"
        }
      ]
    },
    {
      "name": "publishMeasurement",
      "discriminator": [
        86,
        47,
        29,
        38,
        13,
        226,
        134,
        1
      ],
      "accounts": [
        {
          "name": "publisher",
          "writable": true,
          "signer": true
        },
        {
          "name": "measurement",
          "writable": true
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
          "name": "digest",
          "type": {
            "array": [
              "u8",
              48
            ]
          }
        },
        {
          "name": "sourceRepo",
          "type": "string"
        },
        {
          "name": "commitSha",
          "type": "string"
        },
        {
          "name": "recipeHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "version",
          "type": "string"
        }
      ]
    },
    {
      "name": "refreshEnclave",
      "discriminator": [
        186,
        43,
        26,
        36,
        222,
        112,
        250,
        10
      ],
      "accounts": [
        {
          "name": "signingKey",
          "signer": true,
          "relations": [
            "enclave"
          ]
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
          "name": "attestationRecord"
        },
        {
          "name": "enclave",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "signingKey"
              }
            ]
          }
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
          "name": "endpoint",
          "type": "string"
        }
      ]
    },
    {
      "name": "refundCall",
      "discriminator": [
        46,
        165,
        96,
        9,
        152,
        224,
        25,
        51
      ],
      "accounts": [
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "call.caller",
                "account": "call"
              },
              {
                "kind": "account",
                "path": "call.nonce",
                "account": "call"
              }
            ]
          }
        },
        {
          "name": "caller",
          "writable": true
        },
        {
          "name": "escrowTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "callerTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
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
      "args": []
    },
    {
      "name": "registerEnclave",
      "discriminator": [
        212,
        174,
        251,
        235,
        52,
        145,
        141,
        168
      ],
      "accounts": [
        {
          "name": "operator",
          "writable": true,
          "signer": true
        },
        {
          "name": "signingKey",
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
          "name": "attestationRecord"
        },
        {
          "name": "enclave",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "signingKey"
              }
            ]
          }
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
          "name": "encryptionKey",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "endpoint",
          "type": "string"
        }
      ]
    },
    {
      "name": "retireModel",
      "discriminator": [
        78,
        251,
        110,
        104,
        96,
        78,
        230,
        80
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
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
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
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
      "args": []
    },
    {
      "name": "revokeGrant",
      "discriminator": [
        134,
        180,
        57,
        39,
        152,
        7,
        154,
        98
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          },
          "relations": [
            "grant"
          ]
        },
        {
          "name": "grant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "grant.enclave",
                "account": "grant"
              }
            ]
          }
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
      "args": []
    },
    {
      "name": "sealModel",
      "discriminator": [
        130,
        170,
        138,
        45,
        104,
        73,
        50,
        8
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
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
          "name": "ciphertextSha256",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "sealRange",
      "discriminator": [
        236,
        184,
        234,
        164,
        68,
        233,
        228,
        52
      ],
      "accounts": [
        {
          "name": "uploadKey",
          "signer": true
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
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
          "name": "chunkCount",
          "type": "u32"
        }
      ]
    },
    {
      "name": "setAllowedMeasurements",
      "discriminator": [
        25,
        78,
        234,
        157,
        110,
        103,
        244,
        59
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
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
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
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
          "name": "allowedMeasurements",
          "type": {
            "vec": {
              "array": [
                "u8",
                48
              ]
            }
          }
        }
      ]
    },
    {
      "name": "setConfig",
      "discriminator": [
        108,
        158,
        154,
        175,
        212,
        98,
        52,
        66
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
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
          "name": "args",
          "type": {
            "defined": {
              "name": "configArgs"
            }
          }
        }
      ]
    },
    {
      "name": "setPrice",
      "discriminator": [
        16,
        19,
        182,
        8,
        149,
        83,
        72,
        181
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
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
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
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
          "name": "price",
          "type": "u64"
        },
        {
          "name": "priceMint",
          "type": "pubkey"
        },
        {
          "name": "operatorShareBps",
          "type": "u16"
        },
        {
          "name": "priceUnit",
          "type": {
            "defined": {
              "name": "priceUnit"
            }
          }
        }
      ]
    },
    {
      "name": "settleCall",
      "discriminator": [
        58,
        230,
        6,
        58,
        104,
        245,
        154,
        227
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
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          },
          "relations": [
            "call"
          ]
        },
        {
          "name": "enclave",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "enclave"
              }
            ]
          },
          "relations": [
            "call"
          ]
        },
        {
          "name": "attestationRecord"
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "call.caller",
                "account": "call"
              },
              {
                "kind": "account",
                "path": "call.nonce",
                "account": "call"
              }
            ]
          }
        },
        {
          "name": "receipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "call"
              }
            ]
          }
        },
        {
          "name": "caller",
          "writable": true
        },
        {
          "name": "owner",
          "writable": true
        },
        {
          "name": "operator",
          "writable": true
        },
        {
          "name": "feeRecipient",
          "writable": true
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "escrowTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "ownerTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "operatorTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "protocolTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "callerTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
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
          "name": "outputHash",
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
          "name": "ed25519InstructionIndex",
          "type": "u16"
        },
        {
          "name": "openAnswer",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "settleMeteredCall",
      "discriminator": [
        135,
        233,
        76,
        116,
        130,
        184,
        85,
        190
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
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          },
          "relations": [
            "call"
          ]
        },
        {
          "name": "enclave",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "enclave"
              }
            ]
          },
          "relations": [
            "call"
          ]
        },
        {
          "name": "attestationRecord"
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "call.caller",
                "account": "call"
              },
              {
                "kind": "account",
                "path": "call.nonce",
                "account": "call"
              }
            ]
          }
        },
        {
          "name": "receipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "call"
              }
            ]
          }
        },
        {
          "name": "caller",
          "writable": true
        },
        {
          "name": "owner",
          "writable": true
        },
        {
          "name": "operator",
          "writable": true
        },
        {
          "name": "feeRecipient",
          "writable": true
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "escrowTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "ownerTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "operatorTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "protocolTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "callerTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
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
          "name": "count",
          "type": "u64"
        },
        {
          "name": "runningHash",
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
          "name": "ed25519InstructionIndex",
          "type": "u16"
        }
      ]
    },
    {
      "name": "writeWeights",
      "discriminator": [
        17,
        26,
        177,
        52,
        60,
        99,
        254,
        61
      ],
      "accounts": [
        {
          "name": "uploadKey",
          "signer": true
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "weights",
          "writable": true
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
          "name": "offset",
          "type": "u32"
        },
        {
          "name": "bytes",
          "type": "bytes"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "call",
      "discriminator": [
        62,
        231,
        169,
        58,
        154,
        150,
        83,
        196
      ]
    },
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "enclave",
      "discriminator": [
        222,
        166,
        223,
        252,
        18,
        3,
        84,
        34
      ]
    },
    {
      "name": "grant",
      "discriminator": [
        161,
        166,
        11,
        205,
        204,
        135,
        205,
        54
      ]
    },
    {
      "name": "measurement",
      "discriminator": [
        102,
        58,
        48,
        155,
        68,
        220,
        172,
        169
      ]
    },
    {
      "name": "model",
      "discriminator": [
        152,
        221,
        247,
        122,
        185,
        125,
        223,
        151
      ]
    },
    {
      "name": "receipt",
      "discriminator": [
        39,
        154,
        73,
        106,
        80,
        102,
        145,
        153
      ]
    }
  ],
  "events": [
    {
      "name": "callOpened",
      "discriminator": [
        80,
        97,
        83,
        218,
        46,
        113,
        128,
        51
      ]
    },
    {
      "name": "callRefunded",
      "discriminator": [
        251,
        135,
        14,
        71,
        98,
        14,
        36,
        55
      ]
    },
    {
      "name": "callSettled",
      "discriminator": [
        240,
        201,
        54,
        197,
        132,
        33,
        150,
        213
      ]
    },
    {
      "name": "configChanged",
      "discriminator": [
        147,
        25,
        86,
        98,
        98,
        77,
        78,
        192
      ]
    },
    {
      "name": "enclaveChanged",
      "discriminator": [
        172,
        222,
        157,
        110,
        37,
        32,
        242,
        36
      ]
    },
    {
      "name": "grantChanged",
      "discriminator": [
        249,
        62,
        42,
        174,
        52,
        50,
        226,
        161
      ]
    },
    {
      "name": "measurementDeprecated",
      "discriminator": [
        37,
        236,
        155,
        91,
        134,
        208,
        208,
        201
      ]
    },
    {
      "name": "measurementPublished",
      "discriminator": [
        172,
        102,
        54,
        149,
        1,
        131,
        76,
        35
      ]
    },
    {
      "name": "modelAllowedMeasurementsChanged",
      "discriminator": [
        126,
        158,
        15,
        156,
        53,
        232,
        232,
        69
      ]
    },
    {
      "name": "modelCreated",
      "discriminator": [
        233,
        244,
        157,
        153,
        211,
        252,
        76,
        24
      ]
    },
    {
      "name": "modelPriceChanged",
      "discriminator": [
        117,
        35,
        157,
        109,
        59,
        62,
        35,
        35
      ]
    },
    {
      "name": "modelSealed",
      "discriminator": [
        15,
        215,
        238,
        15,
        184,
        75,
        183,
        235
      ]
    },
    {
      "name": "modelStatusChanged",
      "discriminator": [
        234,
        246,
        98,
        82,
        90,
        240,
        19,
        53
      ]
    },
    {
      "name": "rangeSealed",
      "discriminator": [
        134,
        176,
        3,
        229,
        181,
        140,
        220,
        27
      ]
    },
    {
      "name": "weightsAttached",
      "discriminator": [
        225,
        95,
        252,
        229,
        1,
        207,
        233,
        95
      ]
    },
    {
      "name": "weightsWritten",
      "discriminator": [
        231,
        48,
        23,
        136,
        234,
        185,
        86,
        45
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Only the configured authority may perform this action."
    },
    {
      "code": 6001,
      "name": "invalidConfig",
      "msg": "Protocol configuration is invalid."
    },
    {
      "code": 6002,
      "name": "invalidModel",
      "msg": "Model metadata or cipher format is invalid."
    },
    {
      "code": 6003,
      "name": "modelNotUploading",
      "msg": "The model is not uploading."
    },
    {
      "code": 6004,
      "name": "modelNotSealed",
      "msg": "Seal the model before granting it."
    },
    {
      "code": 6005,
      "name": "modelNotLive",
      "msg": "The model does not accept new calls."
    },
    {
      "code": 6006,
      "name": "invalidWeights",
      "msg": "The weights accounts do not match the model."
    },
    {
      "code": 6007,
      "name": "invalidWrite",
      "msg": "The upload has a gap or an out-of-range write."
    },
    {
      "code": 6008,
      "name": "uploadIncomplete",
      "msg": "Every weights byte must be written before sealing."
    },
    {
      "code": 6009,
      "name": "ciphertextHashMismatch",
      "msg": "The ciphertext hash does not match."
    },
    {
      "code": 6010,
      "name": "invalidAttestation",
      "msg": "The attestation record is invalid or expired."
    },
    {
      "code": 6011,
      "name": "measurementNotAllowed",
      "msg": "The enclave measurement is not allowed by this model."
    },
    {
      "code": 6012,
      "name": "invalidEnclave",
      "msg": "The enclave registration does not match its attestation."
    },
    {
      "code": 6013,
      "name": "invalidWrappedKey",
      "msg": "The wrapped key must be a version 1 envelope of 105 bytes."
    },
    {
      "code": 6014,
      "name": "grantRequired",
      "msg": "The enclave does not hold an active grant."
    },
    {
      "code": 6015,
      "name": "callNotOpen",
      "msg": "The call has already settled or been refunded."
    },
    {
      "code": 6016,
      "name": "callDeadlinePassed",
      "msg": "The call settlement deadline has passed."
    },
    {
      "code": 6017,
      "name": "callNotRefundable",
      "msg": "The call deadline has not passed."
    },
    {
      "code": 6018,
      "name": "invalidSignature",
      "msg": "The required Ed25519 verification instruction is missing or does not match."
    },
    {
      "code": 6019,
      "name": "invalidTokenAccount",
      "msg": "The escrow mint or token accounts are invalid."
    },
    {
      "code": 6020,
      "name": "invalidRecipient",
      "msg": "A payment recipient does not match the call snapshot."
    },
    {
      "code": 6021,
      "name": "insufficientEscrow",
      "msg": "The escrow cannot cover the requested payment."
    },
    {
      "code": 6022,
      "name": "arithmeticOverflow",
      "msg": "An arithmetic limit was exceeded."
    },
    {
      "code": 6023,
      "name": "invalidOpenAnswer",
      "msg": "The open answer bytes are empty, exceed the configured limit, or do not match the output hash."
    },
    {
      "code": 6024,
      "name": "invalidCallback",
      "msg": "The callback specification or remaining accounts are invalid."
    },
    {
      "code": 6025,
      "name": "invalidCall",
      "msg": "The call pricing unit or escrow ceiling is invalid for this instruction."
    },
    {
      "code": 6026,
      "name": "invalidMeasurement",
      "msg": "The measurement digest, source metadata, or status is invalid."
    }
  ],
  "types": [
    {
      "name": "answerMode",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "sealed"
          },
          {
            "name": "open"
          }
        ]
      }
    },
    {
      "name": "call",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "inputHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "priceMint",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "operatorShareBps",
            "type": "u16"
          },
          {
            "name": "protocolShareBps",
            "type": "u16"
          },
          {
            "name": "openedSlot",
            "type": "u64"
          },
          {
            "name": "deadlineSlot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "callStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "answerMode",
            "type": {
              "defined": {
                "name": "answerMode"
              }
            }
          },
          {
            "name": "callerIsProgram",
            "type": "bool"
          },
          {
            "name": "callbackProgram",
            "type": "pubkey"
          },
          {
            "name": "callbackAccounts",
            "type": {
              "vec": {
                "defined": {
                  "name": "callbackAccount"
                }
              }
            }
          },
          {
            "name": "priceUnit",
            "type": {
              "defined": {
                "name": "priceUnit"
              }
            }
          },
          {
            "name": "ceiling",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "callOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "inputHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "priceMint",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "operatorShareBps",
            "type": "u16"
          },
          {
            "name": "protocolShareBps",
            "type": "u16"
          },
          {
            "name": "openedSlot",
            "type": "u64"
          },
          {
            "name": "deadlineSlot",
            "type": "u64"
          },
          {
            "name": "answerMode",
            "type": {
              "defined": {
                "name": "answerMode"
              }
            }
          },
          {
            "name": "callerIsProgram",
            "type": "bool"
          },
          {
            "name": "callbackProgram",
            "type": "pubkey"
          },
          {
            "name": "callbackAccounts",
            "type": {
              "vec": {
                "defined": {
                  "name": "callbackAccount"
                }
              }
            }
          },
          {
            "name": "priceUnit",
            "type": {
              "defined": {
                "name": "priceUnit"
              }
            }
          },
          {
            "name": "ceiling",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "callRefunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "priceMint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "callStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "callSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "receipt",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "inputHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "outputHash",
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
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "priceMint",
            "type": "pubkey"
          },
          {
            "name": "total",
            "type": "u64"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "ownerAmount",
            "type": "u64"
          },
          {
            "name": "operatorAmount",
            "type": "u64"
          },
          {
            "name": "protocolAmount",
            "type": "u64"
          },
          {
            "name": "answerMode",
            "type": {
              "defined": {
                "name": "answerMode"
              }
            }
          },
          {
            "name": "openAnswer",
            "type": "bytes"
          },
          {
            "name": "callerIsProgram",
            "type": "bool"
          },
          {
            "name": "deliveredCount",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "returnedAmount",
            "type": {
              "option": "u64"
            }
          }
        ]
      }
    },
    {
      "name": "callStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "settled"
          },
          {
            "name": "refunded"
          }
        ]
      }
    },
    {
      "name": "callbackAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pubkey",
            "type": "pubkey"
          },
          {
            "name": "isWritable",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "callbackSpec",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "program",
            "type": "pubkey"
          },
          {
            "name": "accounts",
            "type": {
              "vec": {
                "defined": {
                  "name": "callbackAccount"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "attestationProgram",
            "type": "pubkey"
          },
          {
            "name": "recordLayoutVersion",
            "type": "u8"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "protocolShareBps",
            "type": "u16"
          },
          {
            "name": "callDeadlineSlots",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "maxOpenAnswerBytes",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "configArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "attestationProgram",
            "type": "pubkey"
          },
          {
            "name": "recordLayoutVersion",
            "type": "u8"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "protocolShareBps",
            "type": "u16"
          },
          {
            "name": "callDeadlineSlots",
            "type": "u64"
          },
          {
            "name": "maxOpenAnswerBytes",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "configChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "config",
            "type": {
              "defined": {
                "name": "configArgs"
              }
            }
          }
        ]
      }
    },
    {
      "name": "createModelArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "manifest",
            "type": "bytes"
          },
          {
            "name": "sizeBytes",
            "type": "u64"
          },
          {
            "name": "cipher",
            "type": "string"
          },
          {
            "name": "noncePrefix",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "allowedMeasurements",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  48
                ]
              }
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "priceMint",
            "type": "pubkey"
          },
          {
            "name": "operatorShareBps",
            "type": "u16"
          },
          {
            "name": "uploadFundingLamports",
            "type": "u64"
          },
          {
            "name": "extraUploadKeyCount",
            "type": "u8"
          },
          {
            "name": "base",
            "type": {
              "option": {
                "defined": {
                  "name": "modelBase"
                }
              }
            }
          },
          {
            "name": "priceUnit",
            "type": {
              "defined": {
                "name": "priceUnit"
              }
            }
          }
        ]
      }
    },
    {
      "name": "enclave",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "signingKey",
            "type": "pubkey"
          },
          {
            "name": "encryptionKey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "endpoint",
            "type": "string"
          },
          {
            "name": "attestationRecord",
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
            "name": "callsSettled",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "enclaveChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "signingKey",
            "type": "pubkey"
          },
          {
            "name": "encryptionKey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "endpoint",
            "type": "string"
          },
          {
            "name": "record",
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
          }
        ]
      }
    },
    {
      "name": "grant",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "wrappedKey",
            "type": "bytes"
          },
          {
            "name": "grantedBy",
            "type": "pubkey"
          },
          {
            "name": "grantedSlot",
            "type": "u64"
          },
          {
            "name": "revoked",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "grantChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "grant",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "wrappedKey",
            "type": "bytes"
          },
          {
            "name": "grantedBy",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "revoked",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "measurement",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "digest",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "publisher",
            "type": "pubkey"
          },
          {
            "name": "sourceRepo",
            "type": "string"
          },
          {
            "name": "commitSha",
            "type": "string"
          },
          {
            "name": "recipeHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "version",
            "type": "string"
          },
          {
            "name": "createdSlot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "measurementStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "measurementDeprecated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "measurement",
            "type": "pubkey"
          },
          {
            "name": "digest",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "measurementStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "measurementPublished",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "measurement",
            "type": "pubkey"
          },
          {
            "name": "digest",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "publisher",
            "type": "pubkey"
          },
          {
            "name": "sourceRepo",
            "type": "string"
          },
          {
            "name": "commitSha",
            "type": "string"
          },
          {
            "name": "recipeHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "version",
            "type": "string"
          },
          {
            "name": "createdSlot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "measurementStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "measurementStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "deprecated"
          }
        ]
      }
    },
    {
      "name": "model",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "manifest",
            "type": "bytes"
          },
          {
            "name": "weights",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "sizeBytes",
            "type": "u64"
          },
          {
            "name": "cipher",
            "type": "string"
          },
          {
            "name": "noncePrefix",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "ciphertextSha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "allowedMeasurements",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  48
                ]
              }
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "priceMint",
            "docs": [
              "Pubkey::default() denotes native SOL."
            ],
            "type": "pubkey"
          },
          {
            "name": "operatorShareBps",
            "type": "u16"
          },
          {
            "name": "uploadKey",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "modelStatus"
              }
            }
          },
          {
            "name": "createdSlot",
            "type": "u64"
          },
          {
            "name": "sealedSlot",
            "type": "u64"
          },
          {
            "name": "callsSettled",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "uploadKeys",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "hashVersion",
            "type": "u8"
          },
          {
            "name": "sealedChunks",
            "type": "u32"
          },
          {
            "name": "merkleFrontier",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          },
          {
            "name": "merkleFrontierMask",
            "type": "u32"
          },
          {
            "name": "base",
            "type": {
              "option": {
                "defined": {
                  "name": "modelBase"
                }
              }
            }
          },
          {
            "name": "priceUnit",
            "type": {
              "defined": {
                "name": "priceUnit"
              }
            }
          }
        ]
      }
    },
    {
      "name": "modelAllowedMeasurementsChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "allowedMeasurements",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  48
                ]
              }
            }
          }
        ]
      }
    },
    {
      "name": "modelBase",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "sizeBytes",
            "type": "u64"
          },
          {
            "name": "format",
            "type": "string"
          },
          {
            "name": "source",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "modelCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "manifest",
            "type": "bytes"
          },
          {
            "name": "weights",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "sizeBytes",
            "type": "u64"
          },
          {
            "name": "cipher",
            "type": "string"
          },
          {
            "name": "noncePrefix",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "allowedMeasurements",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  48
                ]
              }
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "priceMint",
            "type": "pubkey"
          },
          {
            "name": "operatorShareBps",
            "type": "u16"
          },
          {
            "name": "uploadKey",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "uploadKeys",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "hashVersion",
            "type": "u8"
          },
          {
            "name": "base",
            "type": {
              "option": {
                "defined": {
                  "name": "modelBase"
                }
              }
            }
          },
          {
            "name": "priceUnit",
            "type": {
              "defined": {
                "name": "priceUnit"
              }
            }
          }
        ]
      }
    },
    {
      "name": "modelPriceChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "priceMint",
            "type": "pubkey"
          },
          {
            "name": "operatorShareBps",
            "type": "u16"
          },
          {
            "name": "priceUnit",
            "type": {
              "defined": {
                "name": "priceUnit"
              }
            }
          }
        ]
      }
    },
    {
      "name": "modelSealed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "ciphertextSha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "baseSha256",
            "type": {
              "option": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          }
        ]
      }
    },
    {
      "name": "modelStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "uploading"
          },
          {
            "name": "sealed"
          },
          {
            "name": "live"
          },
          {
            "name": "retired"
          }
        ]
      }
    },
    {
      "name": "modelStatusChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "modelStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "priceUnit",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "call"
          },
          {
            "name": "token"
          }
        ]
      }
    },
    {
      "name": "rangeSealed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "startChunk",
            "type": "u32"
          },
          {
            "name": "chunkCount",
            "type": "u32"
          },
          {
            "name": "sealedChunks",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "receipt",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "inputHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "outputHash",
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
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "priceMint",
            "type": "pubkey"
          },
          {
            "name": "total",
            "type": "u64"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "ownerAmount",
            "type": "u64"
          },
          {
            "name": "operatorAmount",
            "type": "u64"
          },
          {
            "name": "protocolAmount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "answerMode",
            "type": {
              "defined": {
                "name": "answerMode"
              }
            }
          },
          {
            "name": "openAnswer",
            "type": "bytes"
          },
          {
            "name": "callerIsProgram",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "weightsAttached",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "weights",
            "type": {
              "vec": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "weightsWritten",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "weights",
            "type": "pubkey"
          },
          {
            "name": "offset",
            "type": "u32"
          },
          {
            "name": "length",
            "type": "u32"
          },
          {
            "name": "writtenBytes",
            "type": "u32"
          }
        ]
      }
    }
  ]
};

// Generated by npm run build:programs. Anchor converts the runtime IDL names to camelCase.
export const IDL: Voynich = {
  "address": "65H3C7T6C2DmbkR9ssBBmNtqpybWcYwotkkETL4E7RSS",
  "metadata": {
    "name": "voynich",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "attach_weights",
      "discriminator": [
        18,
        240,
        93,
        65,
        255,
        88,
        200,
        26
      ],
      "accounts": [
        {
          "name": "upload_key",
          "signer": true
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
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
      "args": []
    },
    {
      "name": "create_model",
      "discriminator": [
        212,
        233,
        41,
        219,
        130,
        212,
        212,
        229
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "upload_key",
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
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "arg",
                "path": "args.name"
              }
            ]
          }
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
          "name": "args",
          "type": {
            "defined": {
              "name": "CreateModelArgs"
            }
          }
        }
      ]
    },
    {
      "name": "deprecate_measurement",
      "discriminator": [
        168,
        198,
        99,
        230,
        225,
        216,
        225,
        88
      ],
      "accounts": [
        {
          "name": "authority",
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
          "name": "measurement",
          "writable": true
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
      "args": []
    },
    {
      "name": "grant_by_enclave",
      "discriminator": [
        224,
        119,
        4,
        9,
        211,
        140,
        40,
        127
      ],
      "accounts": [
        {
          "name": "signing_key",
          "signer": true,
          "relations": [
            "source_enclave"
          ]
        },
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
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "source_enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "signing_key"
              }
            ]
          }
        },
        {
          "name": "source_grant",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "source_enclave"
              }
            ]
          }
        },
        {
          "name": "source_attestation_record"
        },
        {
          "name": "target_enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "target_enclave.signing_key",
                "account": "Enclave"
              }
            ]
          }
        },
        {
          "name": "target_attestation_record"
        },
        {
          "name": "grant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "target_enclave"
              }
            ]
          }
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
          "name": "wrapped_key",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "grant_by_owner",
      "discriminator": [
        201,
        72,
        8,
        221,
        34,
        178,
        68,
        207
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
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
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "target_enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "target_enclave.signing_key",
                "account": "Enclave"
              }
            ]
          }
        },
        {
          "name": "target_attestation_record"
        },
        {
          "name": "grant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "target_enclave"
              }
            ]
          }
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
          "name": "wrapped_key",
          "type": "bytes"
        }
      ]
    },
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
          "name": "program_account",
          "address": "65H3C7T6C2DmbkR9ssBBmNtqpybWcYwotkkETL4E7RSS"
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
          "name": "args",
          "type": {
            "defined": {
              "name": "ConfigArgs"
            }
          }
        }
      ]
    },
    {
      "name": "migrate_config",
      "discriminator": [
        92,
        131,
        58,
        105,
        210,
        154,
        224,
        193
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true
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
          "name": "max_open_answer_bytes",
          "type": "u16"
        }
      ]
    },
    {
      "name": "migrate_model",
      "discriminator": [
        90,
        10,
        167,
        137,
        249,
        28,
        226,
        1
      ],
      "accounts": [
        {
          "name": "authority",
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
          "name": "model",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "open_call",
      "discriminator": [
        153,
        26,
        89,
        45,
        252,
        243,
        183,
        62
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "caller",
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
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          },
          "relations": [
            "grant"
          ]
        },
        {
          "name": "enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "Enclave"
              }
            ]
          },
          "relations": [
            "grant"
          ]
        },
        {
          "name": "attestation_record"
        },
        {
          "name": "grant",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "enclave"
              }
            ]
          }
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "caller"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "caller_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "escrow_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associated_token_program",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
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
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "input_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "answer_mode",
          "type": {
            "defined": {
              "name": "AnswerMode"
            }
          }
        },
        {
          "name": "callback",
          "type": {
            "option": {
              "defined": {
                "name": "CallbackSpec"
              }
            }
          }
        }
      ]
    },
    {
      "name": "open_metered_call",
      "discriminator": [
        92,
        224,
        42,
        248,
        250,
        113,
        170,
        2
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "caller",
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
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          },
          "relations": [
            "grant"
          ]
        },
        {
          "name": "enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "Enclave"
              }
            ]
          },
          "relations": [
            "grant"
          ]
        },
        {
          "name": "attestation_record"
        },
        {
          "name": "grant",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "enclave"
              }
            ]
          }
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "caller"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "caller_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "escrow_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associated_token_program",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
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
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "input_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "answer_mode",
          "type": {
            "defined": {
              "name": "AnswerMode"
            }
          }
        },
        {
          "name": "callback",
          "type": {
            "option": {
              "defined": {
                "name": "CallbackSpec"
              }
            }
          }
        },
        {
          "name": "ceiling",
          "type": "u64"
        }
      ]
    },
    {
      "name": "publish_measurement",
      "discriminator": [
        86,
        47,
        29,
        38,
        13,
        226,
        134,
        1
      ],
      "accounts": [
        {
          "name": "publisher",
          "writable": true,
          "signer": true
        },
        {
          "name": "measurement",
          "writable": true
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
          "name": "digest",
          "type": {
            "array": [
              "u8",
              48
            ]
          }
        },
        {
          "name": "source_repo",
          "type": "string"
        },
        {
          "name": "commit_sha",
          "type": "string"
        },
        {
          "name": "recipe_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "version",
          "type": "string"
        }
      ]
    },
    {
      "name": "refresh_enclave",
      "discriminator": [
        186,
        43,
        26,
        36,
        222,
        112,
        250,
        10
      ],
      "accounts": [
        {
          "name": "signing_key",
          "signer": true,
          "relations": [
            "enclave"
          ]
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
          "name": "attestation_record"
        },
        {
          "name": "enclave",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "signing_key"
              }
            ]
          }
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
          "name": "endpoint",
          "type": "string"
        }
      ]
    },
    {
      "name": "refund_call",
      "discriminator": [
        46,
        165,
        96,
        9,
        152,
        224,
        25,
        51
      ],
      "accounts": [
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "call.caller",
                "account": "Call"
              },
              {
                "kind": "account",
                "path": "call.nonce",
                "account": "Call"
              }
            ]
          }
        },
        {
          "name": "caller",
          "writable": true
        },
        {
          "name": "escrow_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "caller_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
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
      "args": []
    },
    {
      "name": "register_enclave",
      "discriminator": [
        212,
        174,
        251,
        235,
        52,
        145,
        141,
        168
      ],
      "accounts": [
        {
          "name": "operator",
          "writable": true,
          "signer": true
        },
        {
          "name": "signing_key",
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
          "name": "attestation_record"
        },
        {
          "name": "enclave",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "signing_key"
              }
            ]
          }
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
          "name": "encryption_key",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "endpoint",
          "type": "string"
        }
      ]
    },
    {
      "name": "retire_model",
      "discriminator": [
        78,
        251,
        110,
        104,
        96,
        78,
        230,
        80
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
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
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
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
      "args": []
    },
    {
      "name": "revoke_grant",
      "discriminator": [
        134,
        180,
        57,
        39,
        152,
        7,
        154,
        98
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          },
          "relations": [
            "grant"
          ]
        },
        {
          "name": "grant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "grant.enclave",
                "account": "Grant"
              }
            ]
          }
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
      "args": []
    },
    {
      "name": "seal_model",
      "discriminator": [
        130,
        170,
        138,
        45,
        104,
        73,
        50,
        8
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
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
          "name": "ciphertext_sha256",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "seal_range",
      "discriminator": [
        236,
        184,
        234,
        164,
        68,
        233,
        228,
        52
      ],
      "accounts": [
        {
          "name": "upload_key",
          "signer": true
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
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
          "name": "chunk_count",
          "type": "u32"
        }
      ]
    },
    {
      "name": "set_allowed_measurements",
      "discriminator": [
        25,
        78,
        234,
        157,
        110,
        103,
        244,
        59
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
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
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
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
          "name": "allowed_measurements",
          "type": {
            "vec": {
              "array": [
                "u8",
                48
              ]
            }
          }
        }
      ]
    },
    {
      "name": "set_config",
      "discriminator": [
        108,
        158,
        154,
        175,
        212,
        98,
        52,
        66
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
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
          "name": "args",
          "type": {
            "defined": {
              "name": "ConfigArgs"
            }
          }
        }
      ]
    },
    {
      "name": "set_price",
      "discriminator": [
        16,
        19,
        182,
        8,
        149,
        83,
        72,
        181
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
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
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
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
          "name": "price",
          "type": "u64"
        },
        {
          "name": "price_mint",
          "type": "pubkey"
        },
        {
          "name": "operator_share_bps",
          "type": "u16"
        },
        {
          "name": "price_unit",
          "type": {
            "defined": {
              "name": "PriceUnit"
            }
          }
        }
      ]
    },
    {
      "name": "settle_call",
      "discriminator": [
        58,
        230,
        6,
        58,
        104,
        245,
        154,
        227
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
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          },
          "relations": [
            "call"
          ]
        },
        {
          "name": "enclave",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "Enclave"
              }
            ]
          },
          "relations": [
            "call"
          ]
        },
        {
          "name": "attestation_record"
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "call.caller",
                "account": "Call"
              },
              {
                "kind": "account",
                "path": "call.nonce",
                "account": "Call"
              }
            ]
          }
        },
        {
          "name": "receipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "call"
              }
            ]
          }
        },
        {
          "name": "caller",
          "writable": true
        },
        {
          "name": "owner",
          "writable": true
        },
        {
          "name": "operator",
          "writable": true
        },
        {
          "name": "fee_recipient",
          "writable": true
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "escrow_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "owner_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "operator_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "protocol_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "caller_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
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
          "name": "output_hash",
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
          "name": "ed25519_instruction_index",
          "type": "u16"
        },
        {
          "name": "open_answer",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "settle_metered_call",
      "discriminator": [
        135,
        233,
        76,
        116,
        130,
        184,
        85,
        190
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
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          },
          "relations": [
            "call"
          ]
        },
        {
          "name": "enclave",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "Enclave"
              }
            ]
          },
          "relations": [
            "call"
          ]
        },
        {
          "name": "attestation_record"
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "call.caller",
                "account": "Call"
              },
              {
                "kind": "account",
                "path": "call.nonce",
                "account": "Call"
              }
            ]
          }
        },
        {
          "name": "receipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "call"
              }
            ]
          }
        },
        {
          "name": "caller",
          "writable": true
        },
        {
          "name": "owner",
          "writable": true
        },
        {
          "name": "operator",
          "writable": true
        },
        {
          "name": "fee_recipient",
          "writable": true
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "escrow_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "owner_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "operator_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "protocol_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "caller_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
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
          "name": "count",
          "type": "u64"
        },
        {
          "name": "running_hash",
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
          "name": "ed25519_instruction_index",
          "type": "u16"
        }
      ]
    },
    {
      "name": "write_weights",
      "discriminator": [
        17,
        26,
        177,
        52,
        60,
        99,
        254,
        61
      ],
      "accounts": [
        {
          "name": "upload_key",
          "signer": true
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "weights",
          "writable": true
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
          "name": "offset",
          "type": "u32"
        },
        {
          "name": "bytes",
          "type": "bytes"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "Call",
      "discriminator": [
        62,
        231,
        169,
        58,
        154,
        150,
        83,
        196
      ]
    },
    {
      "name": "Config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "Enclave",
      "discriminator": [
        222,
        166,
        223,
        252,
        18,
        3,
        84,
        34
      ]
    },
    {
      "name": "Grant",
      "discriminator": [
        161,
        166,
        11,
        205,
        204,
        135,
        205,
        54
      ]
    },
    {
      "name": "Measurement",
      "discriminator": [
        102,
        58,
        48,
        155,
        68,
        220,
        172,
        169
      ]
    },
    {
      "name": "Model",
      "discriminator": [
        152,
        221,
        247,
        122,
        185,
        125,
        223,
        151
      ]
    },
    {
      "name": "Receipt",
      "discriminator": [
        39,
        154,
        73,
        106,
        80,
        102,
        145,
        153
      ]
    }
  ],
  "events": [
    {
      "name": "CallOpened",
      "discriminator": [
        80,
        97,
        83,
        218,
        46,
        113,
        128,
        51
      ]
    },
    {
      "name": "CallRefunded",
      "discriminator": [
        251,
        135,
        14,
        71,
        98,
        14,
        36,
        55
      ]
    },
    {
      "name": "CallSettled",
      "discriminator": [
        240,
        201,
        54,
        197,
        132,
        33,
        150,
        213
      ]
    },
    {
      "name": "ConfigChanged",
      "discriminator": [
        147,
        25,
        86,
        98,
        98,
        77,
        78,
        192
      ]
    },
    {
      "name": "EnclaveChanged",
      "discriminator": [
        172,
        222,
        157,
        110,
        37,
        32,
        242,
        36
      ]
    },
    {
      "name": "GrantChanged",
      "discriminator": [
        249,
        62,
        42,
        174,
        52,
        50,
        226,
        161
      ]
    },
    {
      "name": "MeasurementDeprecated",
      "discriminator": [
        37,
        236,
        155,
        91,
        134,
        208,
        208,
        201
      ]
    },
    {
      "name": "MeasurementPublished",
      "discriminator": [
        172,
        102,
        54,
        149,
        1,
        131,
        76,
        35
      ]
    },
    {
      "name": "ModelAllowedMeasurementsChanged",
      "discriminator": [
        126,
        158,
        15,
        156,
        53,
        232,
        232,
        69
      ]
    },
    {
      "name": "ModelCreated",
      "discriminator": [
        233,
        244,
        157,
        153,
        211,
        252,
        76,
        24
      ]
    },
    {
      "name": "ModelPriceChanged",
      "discriminator": [
        117,
        35,
        157,
        109,
        59,
        62,
        35,
        35
      ]
    },
    {
      "name": "ModelSealed",
      "discriminator": [
        15,
        215,
        238,
        15,
        184,
        75,
        183,
        235
      ]
    },
    {
      "name": "ModelStatusChanged",
      "discriminator": [
        234,
        246,
        98,
        82,
        90,
        240,
        19,
        53
      ]
    },
    {
      "name": "RangeSealed",
      "discriminator": [
        134,
        176,
        3,
        229,
        181,
        140,
        220,
        27
      ]
    },
    {
      "name": "WeightsAttached",
      "discriminator": [
        225,
        95,
        252,
        229,
        1,
        207,
        233,
        95
      ]
    },
    {
      "name": "WeightsWritten",
      "discriminator": [
        231,
        48,
        23,
        136,
        234,
        185,
        86,
        45
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "Unauthorized",
      "msg": "Only the configured authority may perform this action."
    },
    {
      "code": 6001,
      "name": "InvalidConfig",
      "msg": "Protocol configuration is invalid."
    },
    {
      "code": 6002,
      "name": "InvalidModel",
      "msg": "Model metadata or cipher format is invalid."
    },
    {
      "code": 6003,
      "name": "ModelNotUploading",
      "msg": "The model is not uploading."
    },
    {
      "code": 6004,
      "name": "ModelNotSealed",
      "msg": "Seal the model before granting it."
    },
    {
      "code": 6005,
      "name": "ModelNotLive",
      "msg": "The model does not accept new calls."
    },
    {
      "code": 6006,
      "name": "InvalidWeights",
      "msg": "The weights accounts do not match the model."
    },
    {
      "code": 6007,
      "name": "InvalidWrite",
      "msg": "The upload has a gap or an out-of-range write."
    },
    {
      "code": 6008,
      "name": "UploadIncomplete",
      "msg": "Every weights byte must be written before sealing."
    },
    {
      "code": 6009,
      "name": "CiphertextHashMismatch",
      "msg": "The ciphertext hash does not match."
    },
    {
      "code": 6010,
      "name": "InvalidAttestation",
      "msg": "The attestation record is invalid or expired."
    },
    {
      "code": 6011,
      "name": "MeasurementNotAllowed",
      "msg": "The enclave measurement is not allowed by this model."
    },
    {
      "code": 6012,
      "name": "InvalidEnclave",
      "msg": "The enclave registration does not match its attestation."
    },
    {
      "code": 6013,
      "name": "InvalidWrappedKey",
      "msg": "The wrapped key must be a version 1 envelope of 105 bytes."
    },
    {
      "code": 6014,
      "name": "GrantRequired",
      "msg": "The enclave does not hold an active grant."
    },
    {
      "code": 6015,
      "name": "CallNotOpen",
      "msg": "The call has already settled or been refunded."
    },
    {
      "code": 6016,
      "name": "CallDeadlinePassed",
      "msg": "The call settlement deadline has passed."
    },
    {
      "code": 6017,
      "name": "CallNotRefundable",
      "msg": "The call deadline has not passed."
    },
    {
      "code": 6018,
      "name": "InvalidSignature",
      "msg": "The required Ed25519 verification instruction is missing or does not match."
    },
    {
      "code": 6019,
      "name": "InvalidTokenAccount",
      "msg": "The escrow mint or token accounts are invalid."
    },
    {
      "code": 6020,
      "name": "InvalidRecipient",
      "msg": "A payment recipient does not match the call snapshot."
    },
    {
      "code": 6021,
      "name": "InsufficientEscrow",
      "msg": "The escrow cannot cover the requested payment."
    },
    {
      "code": 6022,
      "name": "ArithmeticOverflow",
      "msg": "An arithmetic limit was exceeded."
    },
    {
      "code": 6023,
      "name": "InvalidOpenAnswer",
      "msg": "The open answer bytes are empty, exceed the configured limit, or do not match the output hash."
    },
    {
      "code": 6024,
      "name": "InvalidCallback",
      "msg": "The callback specification or remaining accounts are invalid."
    },
    {
      "code": 6025,
      "name": "InvalidCall",
      "msg": "The call pricing unit or escrow ceiling is invalid for this instruction."
    },
    {
      "code": 6026,
      "name": "InvalidMeasurement",
      "msg": "The measurement digest, source metadata, or status is invalid."
    }
  ],
  "types": [
    {
      "name": "AnswerMode",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Sealed"
          },
          {
            "name": "Open"
          }
        ]
      }
    },
    {
      "name": "Call",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "input_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "price_mint",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "fee_recipient",
            "type": "pubkey"
          },
          {
            "name": "operator_share_bps",
            "type": "u16"
          },
          {
            "name": "protocol_share_bps",
            "type": "u16"
          },
          {
            "name": "opened_slot",
            "type": "u64"
          },
          {
            "name": "deadline_slot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "CallStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "answer_mode",
            "type": {
              "defined": {
                "name": "AnswerMode"
              }
            }
          },
          {
            "name": "caller_is_program",
            "type": "bool"
          },
          {
            "name": "callback_program",
            "type": "pubkey"
          },
          {
            "name": "callback_accounts",
            "type": {
              "vec": {
                "defined": {
                  "name": "CallbackAccount"
                }
              }
            }
          },
          {
            "name": "price_unit",
            "type": {
              "defined": {
                "name": "PriceUnit"
              }
            }
          },
          {
            "name": "ceiling",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "CallOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "input_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "price_mint",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "fee_recipient",
            "type": "pubkey"
          },
          {
            "name": "operator_share_bps",
            "type": "u16"
          },
          {
            "name": "protocol_share_bps",
            "type": "u16"
          },
          {
            "name": "opened_slot",
            "type": "u64"
          },
          {
            "name": "deadline_slot",
            "type": "u64"
          },
          {
            "name": "answer_mode",
            "type": {
              "defined": {
                "name": "AnswerMode"
              }
            }
          },
          {
            "name": "caller_is_program",
            "type": "bool"
          },
          {
            "name": "callback_program",
            "type": "pubkey"
          },
          {
            "name": "callback_accounts",
            "type": {
              "vec": {
                "defined": {
                  "name": "CallbackAccount"
                }
              }
            }
          },
          {
            "name": "price_unit",
            "type": {
              "defined": {
                "name": "PriceUnit"
              }
            }
          },
          {
            "name": "ceiling",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "CallRefunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "price_mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "CallStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "CallSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "receipt",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "input_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "output_hash",
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
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "price_mint",
            "type": "pubkey"
          },
          {
            "name": "total",
            "type": "u64"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "fee_recipient",
            "type": "pubkey"
          },
          {
            "name": "owner_amount",
            "type": "u64"
          },
          {
            "name": "operator_amount",
            "type": "u64"
          },
          {
            "name": "protocol_amount",
            "type": "u64"
          },
          {
            "name": "answer_mode",
            "type": {
              "defined": {
                "name": "AnswerMode"
              }
            }
          },
          {
            "name": "open_answer",
            "type": "bytes"
          },
          {
            "name": "caller_is_program",
            "type": "bool"
          },
          {
            "name": "delivered_count",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "returned_amount",
            "type": {
              "option": "u64"
            }
          }
        ]
      }
    },
    {
      "name": "CallStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Open"
          },
          {
            "name": "Settled"
          },
          {
            "name": "Refunded"
          }
        ]
      }
    },
    {
      "name": "CallbackAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pubkey",
            "type": "pubkey"
          },
          {
            "name": "is_writable",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "CallbackSpec",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "program",
            "type": "pubkey"
          },
          {
            "name": "accounts",
            "type": {
              "vec": {
                "defined": {
                  "name": "CallbackAccount"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "Config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "attestation_program",
            "type": "pubkey"
          },
          {
            "name": "record_layout_version",
            "type": "u8"
          },
          {
            "name": "fee_recipient",
            "type": "pubkey"
          },
          {
            "name": "protocol_share_bps",
            "type": "u16"
          },
          {
            "name": "call_deadline_slots",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "max_open_answer_bytes",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "ConfigArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "attestation_program",
            "type": "pubkey"
          },
          {
            "name": "record_layout_version",
            "type": "u8"
          },
          {
            "name": "fee_recipient",
            "type": "pubkey"
          },
          {
            "name": "protocol_share_bps",
            "type": "u16"
          },
          {
            "name": "call_deadline_slots",
            "type": "u64"
          },
          {
            "name": "max_open_answer_bytes",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "ConfigChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "config",
            "type": {
              "defined": {
                "name": "ConfigArgs"
              }
            }
          }
        ]
      }
    },
    {
      "name": "CreateModelArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "manifest",
            "type": "bytes"
          },
          {
            "name": "size_bytes",
            "type": "u64"
          },
          {
            "name": "cipher",
            "type": "string"
          },
          {
            "name": "nonce_prefix",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "allowed_measurements",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  48
                ]
              }
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "price_mint",
            "type": "pubkey"
          },
          {
            "name": "operator_share_bps",
            "type": "u16"
          },
          {
            "name": "upload_funding_lamports",
            "type": "u64"
          },
          {
            "name": "extra_upload_key_count",
            "type": "u8"
          },
          {
            "name": "base",
            "type": {
              "option": {
                "defined": {
                  "name": "ModelBase"
                }
              }
            }
          },
          {
            "name": "price_unit",
            "type": {
              "defined": {
                "name": "PriceUnit"
              }
            }
          }
        ]
      }
    },
    {
      "name": "Enclave",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "signing_key",
            "type": "pubkey"
          },
          {
            "name": "encryption_key",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "endpoint",
            "type": "string"
          },
          {
            "name": "attestation_record",
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
            "name": "calls_settled",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "EnclaveChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "signing_key",
            "type": "pubkey"
          },
          {
            "name": "encryption_key",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "endpoint",
            "type": "string"
          },
          {
            "name": "record",
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
          }
        ]
      }
    },
    {
      "name": "Grant",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "wrapped_key",
            "type": "bytes"
          },
          {
            "name": "granted_by",
            "type": "pubkey"
          },
          {
            "name": "granted_slot",
            "type": "u64"
          },
          {
            "name": "revoked",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "GrantChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "grant",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "wrapped_key",
            "type": "bytes"
          },
          {
            "name": "granted_by",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "revoked",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "Measurement",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "digest",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "publisher",
            "type": "pubkey"
          },
          {
            "name": "source_repo",
            "type": "string"
          },
          {
            "name": "commit_sha",
            "type": "string"
          },
          {
            "name": "recipe_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "version",
            "type": "string"
          },
          {
            "name": "created_slot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "MeasurementStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "MeasurementDeprecated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "measurement",
            "type": "pubkey"
          },
          {
            "name": "digest",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "MeasurementStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "MeasurementPublished",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "measurement",
            "type": "pubkey"
          },
          {
            "name": "digest",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "publisher",
            "type": "pubkey"
          },
          {
            "name": "source_repo",
            "type": "string"
          },
          {
            "name": "commit_sha",
            "type": "string"
          },
          {
            "name": "recipe_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "version",
            "type": "string"
          },
          {
            "name": "created_slot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "MeasurementStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "MeasurementStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Active"
          },
          {
            "name": "Deprecated"
          }
        ]
      }
    },
    {
      "name": "Model",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "manifest",
            "type": "bytes"
          },
          {
            "name": "weights",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "size_bytes",
            "type": "u64"
          },
          {
            "name": "cipher",
            "type": "string"
          },
          {
            "name": "nonce_prefix",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "ciphertext_sha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "allowed_measurements",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  48
                ]
              }
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "price_mint",
            "docs": [
              "Pubkey::default() denotes native SOL."
            ],
            "type": "pubkey"
          },
          {
            "name": "operator_share_bps",
            "type": "u16"
          },
          {
            "name": "upload_key",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "ModelStatus"
              }
            }
          },
          {
            "name": "created_slot",
            "type": "u64"
          },
          {
            "name": "sealed_slot",
            "type": "u64"
          },
          {
            "name": "calls_settled",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "upload_keys",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "hash_version",
            "type": "u8"
          },
          {
            "name": "sealed_chunks",
            "type": "u32"
          },
          {
            "name": "merkle_frontier",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          },
          {
            "name": "merkle_frontier_mask",
            "type": "u32"
          },
          {
            "name": "base",
            "type": {
              "option": {
                "defined": {
                  "name": "ModelBase"
                }
              }
            }
          },
          {
            "name": "price_unit",
            "type": {
              "defined": {
                "name": "PriceUnit"
              }
            }
          }
        ]
      }
    },
    {
      "name": "ModelAllowedMeasurementsChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "allowed_measurements",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  48
                ]
              }
            }
          }
        ]
      }
    },
    {
      "name": "ModelBase",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "size_bytes",
            "type": "u64"
          },
          {
            "name": "format",
            "type": "string"
          },
          {
            "name": "source",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "ModelCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "manifest",
            "type": "bytes"
          },
          {
            "name": "weights",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "size_bytes",
            "type": "u64"
          },
          {
            "name": "cipher",
            "type": "string"
          },
          {
            "name": "nonce_prefix",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "allowed_measurements",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  48
                ]
              }
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "price_mint",
            "type": "pubkey"
          },
          {
            "name": "operator_share_bps",
            "type": "u16"
          },
          {
            "name": "upload_key",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "upload_keys",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "hash_version",
            "type": "u8"
          },
          {
            "name": "base",
            "type": {
              "option": {
                "defined": {
                  "name": "ModelBase"
                }
              }
            }
          },
          {
            "name": "price_unit",
            "type": {
              "defined": {
                "name": "PriceUnit"
              }
            }
          }
        ]
      }
    },
    {
      "name": "ModelPriceChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "price_mint",
            "type": "pubkey"
          },
          {
            "name": "operator_share_bps",
            "type": "u16"
          },
          {
            "name": "price_unit",
            "type": {
              "defined": {
                "name": "PriceUnit"
              }
            }
          }
        ]
      }
    },
    {
      "name": "ModelSealed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "ciphertext_sha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "base_sha256",
            "type": {
              "option": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          }
        ]
      }
    },
    {
      "name": "ModelStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Uploading"
          },
          {
            "name": "Sealed"
          },
          {
            "name": "Live"
          },
          {
            "name": "Retired"
          }
        ]
      }
    },
    {
      "name": "ModelStatusChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "ModelStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "PriceUnit",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Call"
          },
          {
            "name": "Token"
          }
        ]
      }
    },
    {
      "name": "RangeSealed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "start_chunk",
            "type": "u32"
          },
          {
            "name": "chunk_count",
            "type": "u32"
          },
          {
            "name": "sealed_chunks",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "Receipt",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "input_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "output_hash",
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
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "price_mint",
            "type": "pubkey"
          },
          {
            "name": "total",
            "type": "u64"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "fee_recipient",
            "type": "pubkey"
          },
          {
            "name": "owner_amount",
            "type": "u64"
          },
          {
            "name": "operator_amount",
            "type": "u64"
          },
          {
            "name": "protocol_amount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "answer_mode",
            "type": {
              "defined": {
                "name": "AnswerMode"
              }
            }
          },
          {
            "name": "open_answer",
            "type": "bytes"
          },
          {
            "name": "caller_is_program",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "WeightsAttached",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "weights",
            "type": {
              "vec": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "WeightsWritten",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "weights",
            "type": "pubkey"
          },
          {
            "name": "offset",
            "type": "u32"
          },
          {
            "name": "length",
            "type": "u32"
          },
          {
            "name": "written_bytes",
            "type": "u32"
          }
        ]
      }
    }
  ]
} as unknown as Voynich
